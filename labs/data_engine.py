"""A throwaway in-memory SQLite database for data-modeling experiments.

It mirrors the real schema (venue -> show -> ticket) at a much larger scale and adds
a denormalized `ticket_view` table, so indexes and normalization trade-offs have
measurable consequences. ticketmaster.db is never touched.
"""

import random
import sqlite3
import threading
import time

SCHEMA = """
CREATE TABLE venue  (id INTEGER PRIMARY KEY, name TEXT NOT NULL, city TEXT NOT NULL, capacity INTEGER NOT NULL);
CREATE TABLE show   (id INTEGER PRIMARY KEY, title TEXT NOT NULL, artist TEXT NOT NULL, date TEXT NOT NULL,
                     venue_id INTEGER NOT NULL REFERENCES venue(id));
CREATE TABLE ticket (id INTEGER PRIMARY KEY, seat_section TEXT NOT NULL, price REAL NOT NULL,
                     status TEXT NOT NULL, buyer_name TEXT, show_id INTEGER NOT NULL REFERENCES show(id));
-- Denormalized copy: show title + venue name duplicated onto every ticket row.
CREATE TABLE ticket_view (id INTEGER PRIMARY KEY, seat_section TEXT, price REAL, status TEXT,
                          show_id INTEGER, show_title TEXT, venue_id INTEGER, venue_name TEXT);
"""

CITIES = ["New York", "Los Angeles", "Chicago", "Austin", "Seattle", "Miami", "Denver", "Boston"]
SECTIONS = ["Floor A", "Floor B", "Lower 101", "Upper 301", "Balcony"]


class DataLab:
    def __init__(self):
        self.conn = sqlite3.connect(":memory:", check_same_thread=False)
        self.lock = threading.Lock()
        self.ticket_count = 0
        self.show_count = 0
        self.generate(20000)

    def generate(self, tickets, shows=500, venues=40, seed=11):
        rng = random.Random(seed)
        with self.lock:
            c = self.conn
            c.executescript("DROP TABLE IF EXISTS ticket_view; DROP TABLE IF EXISTS ticket; DROP TABLE IF EXISTS show; DROP TABLE IF EXISTS venue;")
            c.executescript(SCHEMA)
            c.executemany(
                "INSERT INTO venue VALUES (?,?,?,?)",
                [(i, f"{CITIES[i % len(CITIES)]} Hall {i}", CITIES[i % len(CITIES)], rng.randint(2000, 60000)) for i in range(1, venues + 1)],
            )
            c.executemany(
                "INSERT INTO show VALUES (?,?,?,?,?)",
                [(i, f"Show {i}", f"Artist {i % 97}", f"2026-{i % 12 + 1:02d}-{i % 28 + 1:02d}", rng.randint(1, venues)) for i in range(1, shows + 1)],
            )
            c.executemany(
                "INSERT INTO ticket VALUES (?,?,?,?,?,?)",
                (
                    (i, rng.choice(SECTIONS), float(rng.choice([45, 75, 120, 250])), rng.choice(["available", "sold"]), None, rng.randint(1, shows))
                    for i in range(1, tickets + 1)
                ),
            )
            c.execute(
                """INSERT INTO ticket_view
                   SELECT t.id, t.seat_section, t.price, t.status, s.id, s.title, v.id, v.name
                   FROM ticket t JOIN show s ON s.id = t.show_id JOIN venue v ON v.id = s.venue_id"""
            )
            c.commit()
            self.ticket_count, self.show_count = tickets, shows

    def has_index(self):
        with self.lock:
            return self.conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_ticket_show_id'"
            ).fetchone() is not None

    def set_index(self, on):
        with self.lock:
            if on:
                self.conn.execute("CREATE INDEX IF NOT EXISTS idx_ticket_show_id ON ticket(show_id)")
            else:
                self.conn.execute("DROP INDEX IF EXISTS idx_ticket_show_id")
            self.conn.commit()

    def tickets_for_show(self, show_id, runs=25):
        """The access pattern behind GET /shows/{id}/tickets — timed, with its query plan."""
        sql = "SELECT * FROM ticket WHERE show_id = ?"
        with self.lock:
            plan = [row[-1] for row in self.conn.execute("EXPLAIN QUERY PLAN " + sql, (show_id,))]
            started = time.perf_counter()
            for _ in range(runs):
                rows = self.conn.execute(sql, (show_id,)).fetchall()
            avg_ms = (time.perf_counter() - started) * 1000 / runs
        return {"sql": sql, "plan": plan, "avg_ms": round(avg_ms, 3), "rows": len(rows), "table_rows": self.ticket_count}

    # ---------- normalized vs denormalized ----------

    def read_normalized(self, ticket_id):
        sql = """SELECT t.id, t.seat_section, s.title AS show_title, v.id AS venue_id, v.name AS venue_name
                 FROM ticket t JOIN show s ON s.id = t.show_id JOIN venue v ON v.id = s.venue_id
                 WHERE t.id = ?"""
        with self.lock:
            row = self.conn.execute(sql, (ticket_id,)).fetchone()
        keys = ("id", "seat_section", "show_title", "venue_id", "venue_name")
        return {"sql": " ".join(sql.split()), "row": dict(zip(keys, row)) if row else None}

    def read_denormalized(self, ticket_id):
        sql = "SELECT id, seat_section, show_title, venue_id, venue_name FROM ticket_view WHERE id = ?"
        with self.lock:
            row = self.conn.execute(sql, (ticket_id,)).fetchone()
        keys = ("id", "seat_section", "show_title", "venue_id", "venue_name")
        return {"sql": sql, "row": dict(zip(keys, row)) if row else None}

    def rename_venue(self, venue_id, name):
        """Normalized: one row changes. The denormalized copies are now stale."""
        with self.lock:
            self.conn.execute("UPDATE venue SET name = ? WHERE id = ?", (name, venue_id))
            self.conn.commit()
            stale = self.conn.execute(
                "SELECT COUNT(*) FROM ticket_view WHERE venue_id = ? AND venue_name != ?", (venue_id, name)
            ).fetchone()[0]
        return {"rows_updated": 1, "denormalized_rows_now_stale": stale}

    def backfill(self):
        """What denormalization costs you: fan the change out to every copy."""
        with self.lock:
            started = time.perf_counter()
            cur = self.conn.execute(
                """UPDATE ticket_view SET venue_name = (SELECT name FROM venue WHERE venue.id = ticket_view.venue_id)
                   WHERE venue_name != (SELECT name FROM venue WHERE venue.id = ticket_view.venue_id)"""
            )
            self.conn.commit()
        return {"rows_rewritten": cur.rowcount, "elapsed_ms": round((time.perf_counter() - started) * 1000, 2)}

    # ---------- document model ----------

    def as_document(self, show_id):
        """The same data shaped the way a document store (e.g. MongoDB) would keep it."""
        with self.lock:
            show = self.conn.execute("SELECT id, title, artist, date, venue_id FROM show WHERE id = ?", (show_id,)).fetchone()
            if show is None:
                return None
            venue = self.conn.execute("SELECT id, name, city, capacity FROM venue WHERE id = ?", (show[4],)).fetchone()
            tickets = self.conn.execute(
                "SELECT id, seat_section, price, status FROM ticket WHERE show_id = ? ORDER BY id LIMIT 5", (show_id,)
            ).fetchall()
        return {
            "relational": {
                "show": dict(zip(("id", "title", "artist", "date", "venue_id"), show)),
                "venue": dict(zip(("id", "name", "city", "capacity"), venue)),
                "ticket": [dict(zip(("id", "seat_section", "price", "status", "show_id"), (*t, show_id))) for t in tickets],
            },
            "document": {
                "_id": f"show:{show[0]}",
                "title": show[1],
                "artist": show[2],
                "date": show[3],
                "venue": dict(zip(("id", "name", "city", "capacity"), venue)),
                "tickets": [dict(zip(("id", "seat_section", "price", "status"), t)) for t in tickets],
            },
        }

    def state(self):
        with self.lock:
            sample = self.conn.execute(
                "SELECT t.id, s.venue_id FROM ticket t JOIN show s ON s.id = t.show_id ORDER BY t.id LIMIT 1"
            ).fetchone()
        return {
            "tickets": self.ticket_count,
            "shows": self.show_count,
            "indexed": self.has_index(),
            "sample_ticket_id": sample[0] if sample else None,
            "sample_venue_id": sample[1] if sample else None,
        }
