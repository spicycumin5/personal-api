"""An in-process cache in front of a deliberately slow "database".

The origin is a snapshot of the real shows table (padded with synthetic shows so
eviction has something to do) with an artificial read/write latency, so cache
hits vs misses are visible in the transaction log's timing.
"""

import random
import threading
import time
import zlib
from collections import Counter, OrderedDict
from concurrent.futures import ThreadPoolExecutor

POLICIES = ("LRU", "LFU", "FIFO")
STRATEGIES = ("cache_aside_invalidate", "cache_aside_no_invalidate", "write_through", "write_behind")
CACHE_NODES = ("cache-a", "cache-b", "cache-c", "cache-d")


class SlowOrigin:
    """Stands in for Postgres: correct, durable, and slow."""

    def __init__(self, shows, latency_ms=300):
        self.rows = {s["id"]: dict(s) for s in shows}
        self.latency_ms = latency_ms
        self.reads = 0
        self.writes = 0
        self._lock = threading.Lock()

    def read(self, key):
        time.sleep(self.latency_ms / 1000)
        with self._lock:
            self.reads += 1
            row = self.rows.get(key)
            return dict(row) if row else None

    def write(self, key, fields):
        time.sleep(self.latency_ms / 1000)
        with self._lock:
            self.writes += 1
            self.rows[key].update(fields)
            return dict(self.rows[key])

    def peek(self, key):
        """Instant read used only to *grade* staleness — not part of any strategy."""
        row = self.rows.get(key)
        return dict(row) if row else None


class CacheEngine:
    def __init__(self, shows, capacity=4, ttl=30, policy="LRU", db_latency_ms=300):
        self.origin = SlowOrigin(shows, db_latency_ms)
        self.capacity = capacity
        self.ttl = ttl
        self.policy = policy
        self.entries = OrderedDict()  # key -> {value, freq, inserted_at, expires_at}
        self.hits = 0
        self.misses = 0
        self.evictions = 0
        self.last_evicted = None
        self.write_behind_queue = {}  # key -> pending fields not yet in the DB
        self.flush_delay = 6
        self._flush_timer = None
        self._lock = threading.RLock()
        self._inflight = {}  # key -> threading.Event, for request coalescing

    # ---------- core cache operations ----------

    def _lookup(self, key):
        """Return the cached value or None. Applies TTL and records recency/frequency."""
        with self._lock:
            entry = self.entries.get(key)
            if entry is None:
                return None
            if entry["expires_at"] and entry["expires_at"] < time.time():
                del self.entries[key]
                return None
            entry["freq"] += 1
            if self.policy == "LRU":
                self.entries.move_to_end(key)  # most-recently-used lives at the end
            return dict(entry["value"])

    def _store(self, key, value):
        with self._lock:
            if key in self.entries:
                self.entries[key]["value"] = dict(value)
                self.entries[key]["expires_at"] = time.time() + self.ttl if self.ttl else None
                if self.policy == "LRU":
                    self.entries.move_to_end(key)
                return
            if len(self.entries) >= self.capacity:
                self._evict()
            self.entries[key] = {
                "value": dict(value),
                "freq": 1,
                "inserted_at": time.time(),
                "expires_at": time.time() + self.ttl if self.ttl else None,
            }

    def _evict(self):
        if self.policy == "LFU":
            victim = min(self.entries, key=lambda k: (self.entries[k]["freq"], self.entries[k]["inserted_at"]))
        else:
            # LRU: front of the OrderedDict is least-recently used.
            # FIFO: we never reorder on access, so the front is simply the oldest insert.
            victim = next(iter(self.entries))
        del self.entries[victim]
        self.evictions += 1
        self.last_evicted = victim

    def delete(self, key):
        with self._lock:
            self.entries.pop(key, None)

    # ---------- read path: cache-aside ----------

    def get(self, key):
        """Cache-aside: check cache -> on miss read DB -> populate cache -> return."""
        cached = self._lookup(key)
        if cached is not None:
            self.hits += 1
            return cached, "HIT"
        self.misses += 1
        value = self.origin.read(key)
        if value is not None:
            self._store(key, value)
        return value, "MISS"

    def get_coalesced(self, key):
        """Like get(), but concurrent misses for one key share a single DB read."""
        cached = self._lookup(key)
        if cached is not None:
            self.hits += 1
            return cached, "HIT"
        with self._lock:
            event = self._inflight.get(key)
            leader = event is None
            if leader:
                event = threading.Event()
                self._inflight[key] = event
        if not leader:
            event.wait()
            self.hits += 1
            return self._lookup(key), "COALESCED"
        try:
            self.misses += 1
            value = self.origin.read(key)
            if value is not None:
                self._store(key, value)
            return value, "MISS"
        finally:
            with self._lock:
                self._inflight.pop(key, None)
            event.set()

    # ---------- write path: four strategies ----------

    def write(self, key, fields, strategy):
        if strategy == "cache_aside_invalidate":
            self.origin.write(key, fields)
            self.delete(key)  # next read misses and fetches the fresh row
        elif strategy == "cache_aside_no_invalidate":
            self.origin.write(key, fields)  # cache still holds the old row -> stale reads
        elif strategy == "write_through":
            fresh = self.origin.write(key, fields)  # synchronous: caller waits for the DB
            self._store(key, fresh)
        elif strategy == "write_behind":
            current = self._lookup(key) or self.origin.peek(key)
            current.update(fields)
            self._store(key, current)
            with self._lock:
                self.write_behind_queue.setdefault(key, {}).update(fields)
            self._schedule_flush()  # the DB catches up later
        else:
            raise ValueError(f"unknown strategy {strategy}")

    def _schedule_flush(self):
        with self._lock:
            if self._flush_timer is None:
                self._flush_timer = threading.Timer(self.flush_delay, self.flush)
                self._flush_timer.daemon = True
                self._flush_timer.start()

    def flush(self):
        with self._lock:
            pending, self.write_behind_queue = self.write_behind_queue, {}
            self._flush_timer = None
        for key, fields in pending.items():
            self.origin.write(key, fields)
        return list(pending)

    def crash(self):
        """Simulate the cache process dying: memory is gone, including unflushed writes."""
        with self._lock:
            lost = {k: dict(v) for k, v in self.write_behind_queue.items()}
            self.entries.clear()
            self.write_behind_queue.clear()
            if self._flush_timer:
                self._flush_timer.cancel()
                self._flush_timer = None
        return lost

    # ---------- failure modes ----------

    def stampede(self, key, concurrency, coalesce):
        """Expire `key`, then hit it with `concurrency` simultaneous requests."""
        self.delete(key)
        reads_before = self.origin.reads
        fetch = self.get_coalesced if coalesce else self.get
        started = time.perf_counter()
        with ThreadPoolExecutor(max_workers=concurrency) as pool:
            results = list(pool.map(lambda _: fetch(key)[1], range(concurrency)))
        return {
            "key": key,
            "concurrency": concurrency,
            "coalesce": coalesce,
            "db_reads": self.origin.reads - reads_before,
            "outcomes": dict(Counter(results)),
            "elapsed_ms": round((time.perf_counter() - started) * 1000, 1),
        }

    def hot_key_traffic(self, requests, replicate):
        """Zipf-ish traffic over show keys, routed to 4 cache nodes by hash.
        With `replicate`, the hottest key is copied to 3 nodes and reads spread across them."""
        keys = sorted(self.origin.rows)
        weights = [1 / (rank + 1) ** 1.6 for rank in range(len(keys))]
        hot = keys[0]
        per_key = Counter()
        per_node = Counter({n: 0 for n in CACHE_NODES})
        for key in random.choices(keys, weights=weights, k=requests):
            per_key[key] += 1
            home = zlib.crc32(str(key).encode()) % len(CACHE_NODES)
            if replicate and key == hot:
                # copies key#0..key#2 live on three different nodes; each read picks one
                node = CACHE_NODES[(home + random.randrange(3)) % len(CACHE_NODES)]
            else:
                node = CACHE_NODES[home]
            per_node[node] += 1
        return {
            "requests": requests,
            "replicate": replicate,
            "hot_key": hot,
            "per_key": [{"key": k, "count": per_key[k]} for k in keys],
            "per_node": [{"node": n, "count": per_node[n]} for n in CACHE_NODES],
        }

    # ---------- introspection ----------

    def state(self):
        now = time.time()
        with self._lock:
            entries = [
                {
                    "key": k,
                    "title": e["value"].get("title"),
                    "freq": e["freq"],
                    "ttl_left": round(e["expires_at"] - now, 1) if e["expires_at"] else None,
                    "stale": self.origin.peek(k) != e["value"],
                }
                for k, e in self.entries.items()
            ]
            return {
                "config": {
                    "capacity": self.capacity,
                    "ttl": self.ttl,
                    "policy": self.policy,
                    "db_latency_ms": self.origin.latency_ms,
                    "flush_delay": self.flush_delay,
                },
                "entries": entries,
                "stats": {
                    "hits": self.hits,
                    "misses": self.misses,
                    "evictions": self.evictions,
                    "db_reads": self.origin.reads,
                    "db_writes": self.origin.writes,
                    "last_evicted": self.last_evicted,
                },
                "write_behind_queue": [{"key": k, "fields": v} for k, v in self.write_behind_queue.items()],
                "origin": [self.origin.peek(k) for k in sorted(self.origin.rows)],
            }
