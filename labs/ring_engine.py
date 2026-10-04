"""Consistent hashing: nodes and keys share one 32-bit circular hash space.

A key belongs to the first node position found walking clockwise from the key.
Virtual nodes give each physical node many positions so load evens out.
"""

import bisect
import hashlib
import statistics

RING_SIZE = 2**32
MAX_NODES = 8


def ring_hash(value):
    """md5 -> first 4 bytes -> position on the ring [0, 2^32)."""
    return int.from_bytes(hashlib.md5(str(value).encode()).digest()[:4], "big")


class HashRing:
    def __init__(self, nodes=(), vnodes=1):
        self.vnodes = vnodes
        self.nodes = []
        self._positions = []  # sorted vnode positions
        self._owners = {}  # position -> physical node name
        for n in nodes:
            self.add_node(n)

    def _vnode_positions(self, node):
        return [ring_hash(f"{node}#vn{i}") for i in range(self.vnodes)]

    def add_node(self, node):
        self.nodes.append(node)
        for pos in self._vnode_positions(node):
            bisect.insort(self._positions, pos)
            self._owners[pos] = node

    def remove_node(self, node):
        self.nodes.remove(node)
        for pos in self._vnode_positions(node):
            self._positions.remove(pos)
            del self._owners[pos]

    def lookup(self, key):
        """Walk clockwise: first vnode position >= hash(key), wrapping to the start."""
        if not self._positions:
            return None, None
        h = ring_hash(key)
        i = bisect.bisect_left(self._positions, h)
        pos = self._positions[i % len(self._positions)]
        return self._owners[pos], pos

    def set_vnodes(self, vnodes):
        nodes = list(self.nodes)
        self.__init__(nodes, vnodes)

    def vnode_list(self):
        return [{"position": p, "node": self._owners[p]} for p in self._positions]


def modulo_owner(key, nodes):
    """The naive alternative: hash(key) % N."""
    return nodes[ring_hash(key) % len(nodes)] if nodes else None


class RingLab:
    def __init__(self, key_count=240, vnodes=1):
        self.keys = [f"ticket:{i}" for i in range(1, key_count + 1)]
        self.ring = HashRing(["db-1", "db-2", "db-3", "db-4"], vnodes)

    def assignments(self):
        return {k: self.ring.lookup(k)[0] for k in self.keys}

    def modulo_assignments(self, nodes):
        return {k: modulo_owner(k, nodes) for k in self.keys}

    def _diff(self, before_ring, before_mod, after_ring, after_mod):
        moved = [k for k in self.keys if before_ring[k] != after_ring[k]]
        moved_mod = [k for k in self.keys if before_mod[k] != after_mod[k]]
        n = len(self.keys)
        return {
            "moved_keys": moved,
            "moved_pct": round(100 * len(moved) / n, 1),
            "modulo_moved_pct": round(100 * len(moved_mod) / n, 1),
        }

    def add_node(self, name=None):
        # Reuse the lowest free name so each db-N keeps a stable colour slot in the UI.
        name = name or next(f"db-{i}" for i in range(1, MAX_NODES + 1) if f"db-{i}" not in self.ring.nodes)
        before = self.assignments()
        before_mod = self.modulo_assignments(self.ring.nodes)
        self.ring.add_node(name)
        diff = self._diff(before, before_mod, self.assignments(), self.modulo_assignments(self.ring.nodes))
        return {"action": "add", "node": name, **diff}

    def remove_node(self, name):
        before = self.assignments()
        before_mod = self.modulo_assignments(self.ring.nodes)
        self.ring.remove_node(name)
        diff = self._diff(before, before_mod, self.assignments(), self.modulo_assignments(self.ring.nodes))
        return {"action": "remove", "node": name, **diff}

    def state(self):
        owners = self.assignments()
        load = {n: 0 for n in self.ring.nodes}
        for owner in owners.values():
            load[owner] += 1
        counts = list(load.values())
        ideal = len(self.keys) / max(1, len(counts))
        return {
            "ring_size": RING_SIZE,
            "vnodes": self.ring.vnodes,
            "nodes": self.ring.nodes,
            "positions": self.ring.vnode_list(),
            "keys": [{"key": k, "position": ring_hash(k), "node": owners[k]} for k in self.keys],
            "load": [{"node": n, "keys": c} for n, c in load.items()],
            "balance": {
                "ideal": round(ideal, 1),
                "stddev": round(statistics.pstdev(counts), 1) if counts else 0,
                "max_over_ideal": round(max(counts) / ideal, 2) if counts else 0,
            },
        }
