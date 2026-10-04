"""Snapshots of the real Ticket Desk data for the labs to play with.

Labs never write back to ticketmaster.db; they copy what's there and pad it with
synthetic rows so there's enough data for eviction, sharding, etc. to be visible.
"""

import random

from models import Show, Ticket, Venue

SYNTH_ARTISTS = [
    "Taylor Swift", "The Wavelengths", "Clara Finch", "Neon Harbor", "Mira Sol",
    "Static Bloom", "Juniper & Oak", "The Late Trains", "Kofi Ames", "Velvet Arcade",
    "Ruth Okafor", "Paper Comets",
]
SYNTH_CITIES = ["New York", "Los Angeles", "Chicago", "Austin", "Seattle", "Miami", "Denver", "Boston"]
SECTIONS = ["Floor A", "Floor B", "Lower 101", "Lower 105", "Upper 301", "Upper 310", "Balcony", "Box"]


def show_snapshot(min_count=10):
    """Real shows (with venue name embedded) padded with synthetic ones up to min_count."""
    venues = {v.id: v for v in Venue.query.all()}
    shows = [
        {
            "id": s.id,
            "title": s.title,
            "artist": s.artist,
            "date": s.date,
            "venue": venues[s.venue_id].name if s.venue_id in venues else None,
        }
        for s in Show.query.order_by(Show.id).all()
    ]
    next_id = (shows[-1]["id"] if shows else 0) + 1
    i = 0
    while len(shows) < min_count:
        artist = SYNTH_ARTISTS[i % len(SYNTH_ARTISTS)]
        shows.append(
            {
                "id": next_id,
                "title": f"{artist} Live",
                "artist": artist,
                "date": f"2026-{(i % 12) + 1:02d}-{(i * 7) % 28 + 1:02d}",
                "venue": f"{SYNTH_CITIES[i % len(SYNTH_CITIES)]} Arena",
            }
        )
        next_id += 1
        i += 1
    return shows


def ticket_snapshot(synthetic=600, seed=7):
    """Real tickets plus synthetic ones. Show #1 of the synthetic set is a 'mega show'
    (Taylor Swift) that gets a disproportionate share of tickets — the hot spot."""
    rng = random.Random(seed)
    venues = {v.id: v for v in Venue.query.all()}
    shows = {s.id: s for s in Show.query.all()}
    rows = [
        {
            "id": t.id,
            "show_id": t.show_id,
            "seat_section": t.seat_section,
            "price": t.price,
            "status": t.status,
            "venue_city": venues[shows[t.show_id].venue_id].city if t.show_id in shows else "Unknown",
            "date": shows[t.show_id].date if t.show_id in shows else "2026-01-01",
        }
        for t in Ticket.query.order_by(Ticket.id).all()
    ]
    next_id = (max((r["id"] for r in rows), default=0)) + 1
    base_show = (max(shows, default=0)) + 1
    synth_shows = 12
    mega = base_show  # the Taylor Swift show
    for _ in range(synthetic):
        show_id = mega if rng.random() < 0.35 else base_show + rng.randrange(synth_shows)
        idx = show_id - base_show
        rows.append(
            {
                "id": next_id,
                "show_id": show_id,
                "seat_section": rng.choice(SECTIONS),
                "price": float(rng.choice([45, 75, 120, 150, 250, 600])),
                "status": "sold" if rng.random() < 0.6 else "available",
                "venue_city": SYNTH_CITIES[idx % len(SYNTH_CITIES)],
                "date": f"2026-{(idx % 12) + 1:02d}-{(idx * 5) % 28 + 1:02d}",
            }
        )
        next_id += 1
    return rows, mega
