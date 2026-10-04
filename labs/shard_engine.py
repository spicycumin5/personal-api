"""Partition the tickets table across N in-memory shards.

Three strategies (range, hash, directory) and a choice of shard key, so you can
see how the key decides balance, hot spots, and whether a query hits 1 shard or all.
"""

import random
import threading
import zlib
from collections import Counter

from labs.sync import synchronized

STRATEGIES = ("range", "hash", "directory")
SHARD_KEYS = ("show_id", "ticket_id", "venue_city", "status", "show_id+seat_section")
PER_SHARD_MS = 15  # simulated time for one shard to answer
FANOUT_OVERHEAD_MS = 5  # per extra shard: connection + merge cost in scatter-gather


def key_value(row, shard_key):
    if shard_key == "ticket_id":
        return row["id"]
    if shard_key == "show_id+seat_section":
        return f"{row['show_id']}:{row['seat_section']}"
    return row[shard_key]


class ShardCluster:
    def __init__(self, rows, mega_show, num_shards=4, strategy="hash", shard_key="show_id"):
        self.rows = rows
        self.mega_show = mega_show
        self.num_shards = num_shards
        self.strategy = strategy
        self.shard_key = shard_key
        self.directory = {}
        self.range_bounds = []
        self.placement = {}  # ticket id -> shard index
        self._lock = threading.RLock()
        self._build()

    # ---------- routing: key value -> shard ----------

    def _build(self):
        values = [key_value(r, self.shard_key) for r in self.rows]
        distinct = sorted(set(values), key=lambda v: (isinstance(v, str), v))
        if self.strategy == "range":
            # Split the *sorted key space* into N contiguous chunks of distinct values.
            size = max(1, -(-len(distinct) // self.num_shards))
            self.range_bounds = [distinct[i * size] for i in range(self.num_shards) if i * size < len(distinct)]
        elif self.strategy == "directory":
            # A lookup table: place each key value on the currently least-loaded shard.
            counts = Counter(values)
            loads = [0] * self.num_shards
            self.directory = {}
            for v in sorted(distinct, key=lambda v: -counts[v]):
                target = loads.index(min(loads))
                self.directory[v] = target
                loads[target] += counts[v]
        self.placement = {r["id"]: self.route(key_value(r, self.shard_key)) for r in self.rows}

    @synchronized
    def reconfigure(self, strategy, shard_key, num_shards):
        """Re-partition every row; returns the old placement so callers can diff it."""
        before = dict(self.placement)
        self.strategy, self.shard_key, self.num_shards = strategy, shard_key, num_shards
        self._build()
        return before

    def route(self, value):
        if self.strategy == "hash":
            return zlib.crc32(str(value).encode()) % self.num_shards
        if self.strategy == "range":
            shard = 0
            for i, lower in enumerate(self.range_bounds):
                if (isinstance(value, str), value) >= (isinstance(lower, str), lower):
                    shard = i
            return shard
        return self.directory.get(value, 0)

    # ---------- queries ----------

    @synchronized
    def query_by_show(self, show_id):
        """Tickets for one show. Only targetable if the shard key *is* show_id."""
        if self.shard_key == "show_id":
            touched = [self.route(show_id)]
        else:
            touched = list(range(self.num_shards))  # scatter-gather
        rows = [r for r in self.rows if r["show_id"] == show_id and self.placement[r["id"]] in touched]
        return self._query_result(f"show_id = {show_id}", touched, rows)

    @synchronized
    def query_by_ticket(self, ticket_id):
        if self.shard_key == "ticket_id":
            touched = [self.route(ticket_id)]
        else:
            touched = list(range(self.num_shards))
        rows = [r for r in self.rows if r["id"] == ticket_id]
        return self._query_result(f"ticket_id = {ticket_id}", touched, rows)

    def _query_result(self, where, touched, rows):
        latency = PER_SHARD_MS + FANOUT_OVERHEAD_MS * (len(touched) - 1)
        return {
            "where": where,
            "shard_key": self.shard_key,
            "shards_touched": touched,
            "scatter_gather": len(touched) > 1,
            "rows": len(rows),
            "sample": rows[:5],
            "simulated_latency_ms": latency,
        }

    # ---------- load ----------

    def distribution(self):
        counts = Counter(self.placement.values())
        sizes = [counts.get(i, 0) for i in range(self.num_shards)]
        avg = sum(sizes) / self.num_shards
        return {
            "sizes": sizes,
            "imbalance": round(max(sizes) / avg, 2) if avg else 0,
            "distinct_key_values": len({key_value(r, self.shard_key) for r in self.rows}),
        }

    @synchronized
    def traffic(self, requests=5000, seed=None):
        """Reads where 60% of fans are trying to see the mega show's tickets."""
        rng = random.Random(seed)
        mega_rows = [r for r in self.rows if r["show_id"] == self.mega_show]
        other_rows = [r for r in self.rows if r["show_id"] != self.mega_show]
        load = [0] * self.num_shards
        for _ in range(requests):
            row = rng.choice(mega_rows) if mega_rows and rng.random() < 0.6 else rng.choice(other_rows)
            load[self.placement[row["id"]]] += 1
        hottest = load.index(max(load))
        return {
            "requests": requests,
            "per_shard": load,
            "hottest_shard": hottest,
            "hottest_share_pct": round(100 * load[hottest] / requests, 1),
            "mega_show": self.mega_show,
        }

    @synchronized
    def state(self):
        return {
            "config": {
                "num_shards": self.num_shards,
                "strategy": self.strategy,
                "shard_key": self.shard_key,
            },
            "total_rows": len(self.rows),
            "mega_show": self.mega_show,
            "show_ids": sorted({r["show_id"] for r in self.rows}),
            "distribution": self.distribution(),
            "range_bounds": self.range_bounds if self.strategy == "range" else None,
            "directory_sample": (
                [{"value": v, "shard": s} for v, s in list(self.directory.items())[:12]]
                if self.strategy == "directory"
                else None
            ),
        }


def moved_pct(before, after):
    moved = sum(1 for tid, shard in after.items() if before.get(tid) != shard)
    return round(100 * moved / max(1, len(after)), 1)
