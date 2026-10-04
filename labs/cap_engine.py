"""Three replicas of one show's seat map, a network you can cut, and a CP/AP switch.

CP: a write must reach a majority (2 of 3) synchronously, so the minority side of a
    partition refuses writes -> consistent, but not available.
AP: every replica accepts writes locally and replicates asynchronously, so both
    sides keep selling -> available, but two fans can buy the same seat.

Replication is delivered lazily: messages carry a deliver_at time and are applied
on the next request after that time, if the link between the replicas is up.
"""

import threading
import time

from labs.sync import synchronized

REPLICAS = ("us-east", "us-west", "eu")
SEATS = [f"{row}{n}" for row in "ABC" for n in range(1, 5)]


class Unavailable(Exception):
    pass


class SeatTaken(Exception):
    pass


class CapCluster:
    def __init__(self, mode="CP", lag_ms=2500):
        self.mode = mode
        self.lag_ms = lag_ms
        self.isolated = set()
        self.seats = {r: {s: None for s in SEATS} for r in REPLICAS}  # seat -> {holder, ts, origin}
        self.pending = []  # replication messages in flight
        self.conflicts = []
        self.events = []
        self.last_write_replica = {}  # client -> replica (for read-your-writes)
        self._clock = 0
        self._lock = threading.RLock()

    # ---------- network ----------

    def group(self, replica):
        """Replicas that `replica` can currently talk to (including itself)."""
        same_side = self.isolated if replica in self.isolated else set(REPLICAS) - self.isolated
        return sorted(same_side)

    def link_up(self, a, b):
        return (a in self.isolated) == (b in self.isolated)

    def _log(self, msg):
        self.events.insert(0, {"t": round(time.time(), 2), "msg": msg})
        del self.events[30:]

    # ---------- replication ----------

    def _apply(self, replica, seat, record):
        current = self.seats[replica][seat]
        if current is None or current["ts"] < record["ts"]:
            if current is not None and current["holder"] != record["holder"]:
                self._conflict(seat, winner=record, loser=current)
            self.seats[replica][seat] = dict(record)
        elif current["holder"] != record["holder"]:
            self._conflict(seat, winner=current, loser=record)

    def _conflict(self, seat, winner, loser):
        key = (seat, loser["holder"])
        if any((c["seat"], c["loser"]) == key for c in self.conflicts):
            return
        self.conflicts.append(
            {
                "seat": seat,
                "winner": winner["holder"],
                "loser": loser["holder"],
                "resolution": "last-writer-wins: later timestamp keeps the seat, the other fan is refunded",
            }
        )
        self._log(f"DOUBLE BOOKING on {seat}: {winner['holder']} keeps it, {loser['holder']} refunded")

    @synchronized
    def deliver(self):
        now = time.time()
        still_pending = []
        for m in self.pending:
            if m["deliver_at"] <= now and self.link_up(m["from"], m["to"]):
                self._apply(m["to"], m["seat"], m["record"])
            else:
                still_pending.append(m)
        self.pending = still_pending

    def _replicate_async(self, origin, seat, record, skip=()):
        for r in REPLICAS:
            if r != origin and r not in skip:
                self.pending.append(
                    {"from": origin, "to": r, "seat": seat, "record": record, "deliver_at": time.time() + self.lag_ms / 1000}
                )

    # ---------- writes ----------

    @synchronized
    def book(self, replica, client, seat):
        self.deliver()
        self._clock += 1
        record = {"holder": client, "ts": self._clock, "origin": replica}

        if self.mode == "CP":
            reachable = self.group(replica)
            if len(reachable) < 2:  # can't form a quorum of 2/3
                self._log(f"{client}@{replica}: REJECTED — can't reach a quorum during the partition")
                raise Unavailable(f"{replica} can only reach {reachable}; a write needs 2 of 3 replicas")
            # Majority quorums always overlap, so the quorum knows about any earlier sale.
            for r in reachable:
                if self.seats[r][seat] is not None:
                    raise SeatTaken(f"{seat} already sold to {self.seats[r][seat]['holder']}")
            for r in reachable:  # synchronous replication to everyone reachable
                self.seats[r][seat] = dict(record)
            self._replicate_async(replica, seat, record, skip=reachable)  # catch up the rest after heal
            self._log(f"{client}@{replica}: booked {seat} (quorum {reachable})")
        else:
            if self.seats[replica][seat] is not None:
                raise SeatTaken(f"{seat} already sold to {self.seats[replica][seat]['holder']} (as far as {replica} knows)")
            self.seats[replica][seat] = dict(record)
            self._replicate_async(replica, seat, record)
            self._log(f"{client}@{replica}: booked {seat} locally; replicating async")

        self.last_write_replica[client] = replica
        return record

    # ---------- reads ----------

    @synchronized
    def read(self, replica, level, client=None):
        self.deliver()
        if level == "strong":
            reachable = self.group(replica)
            if len(reachable) < 2:
                raise Unavailable(f"{replica} can't reach a majority for a strong read")
            # Read from the quorum and take the newest version of each seat.
            merged = {}
            for seat in SEATS:
                versions = [self.seats[r][seat] for r in reachable if self.seats[r][seat]]
                merged[seat] = max(versions, key=lambda v: v["ts"]) if versions else None
            return merged, f"quorum {reachable}"
        if level == "read_your_writes" and client in self.last_write_replica:
            home = self.last_write_replica[client]
            if self.link_up(replica, home):
                return dict(self.seats[home]), f"routed to {home} (where {client} last wrote)"
        return dict(self.seats[replica]), f"local {replica}"

    # ---------- partition control ----------

    @synchronized
    def partition(self, isolate):
        self.isolated = set(isolate) & set(REPLICAS)
        self._log(f"PARTITION: {sorted(self.isolated)} cut off from the rest")

    @synchronized
    def heal(self):
        self.isolated = set()
        self._log("Network healed — replaying queued replication")
        # Healing doesn't wait for lag: queued messages flush as soon as links return.
        for m in self.pending:
            m["deliver_at"] = min(m["deliver_at"], time.time())
        self.deliver()

    @synchronized
    def state(self):
        self.deliver()
        divergent = [s for s in SEATS if len({str(self.seats[r][s] and self.seats[r][s]["holder"]) for r in REPLICAS}) > 1]
        return {
            "mode": self.mode,
            "lag_ms": self.lag_ms,
            "replicas": [
                {"name": r, "reachable": self.group(r), "isolated": r in self.isolated, "seats": self.seats[r]}
                for r in REPLICAS
            ],
            "seat_ids": SEATS,
            "pending_replication": len(self.pending),
            "divergent_seats": divergent,
            "conflicts": self.conflicts,
            "events": self.events,
        }
