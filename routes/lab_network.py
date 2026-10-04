"""Networking demos: a simulated L7 load balancer and a deliberately flaky service.

The retry / backoff / circuit-breaker logic lives in the browser (NetworkingLab.jsx),
because that's where it belongs: the *caller* decides how to survive a bad dependency.
"""

import random
import threading
import time
import zlib

from flask import Blueprint, jsonify, request

from labs.snippets import snippet

net_lab_bp = Blueprint("net_lab", __name__, url_prefix="/api/lab/net")

ALGORITHMS = ("round_robin", "least_conn", "ip_hash")


class LoadBalancer:
    def __init__(self):
        self.servers = {
            "app-1": {"latency_ms": 60, "healthy": True, "inflight": 0, "served": 0},
            "app-2": {"latency_ms": 220, "healthy": True, "inflight": 0, "served": 0},
            "app-3": {"latency_ms": 110, "healthy": True, "inflight": 0, "served": 0},
        }
        self._rr = 0
        self._lock = threading.Lock()

    def pick(self, algo, client):
        """Choose a backend among the ones passing health checks."""
        with self._lock:
            healthy = [name for name, s in self.servers.items() if s["healthy"]]
            if not healthy:
                return None
            if algo == "least_conn":
                name = min(healthy, key=lambda n: self.servers[n]["inflight"])
            elif algo == "ip_hash":
                name = healthy[zlib.crc32(client.encode()) % len(healthy)]  # sticky per client
            else:
                name = healthy[self._rr % len(healthy)]
                self._rr += 1
            self.servers[name]["inflight"] += 1
            return name

    def finish(self, name):
        with self._lock:
            self.servers[name]["inflight"] -= 1
            self.servers[name]["served"] += 1


_lb = LoadBalancer()
_flaky = {"outage": False}


@net_lab_bp.route("/lb", methods=["GET"])
@snippet("net.lb", LoadBalancer.pick)
def load_balanced():
    algo = request.args.get("algo", "round_robin")
    if algo not in ALGORITHMS:
        return jsonify({"error": f"algo must be one of {ALGORITHMS}"}), 400
    client = request.args.get("client", request.remote_addr or "anon")
    name = _lb.pick(algo, client)
    if name is None:
        return jsonify({"error": "No healthy backends"}), 503
    server = _lb.servers[name]
    inflight_seen = {n: s["inflight"] for n, s in _lb.servers.items()}
    time.sleep(server["latency_ms"] / 1000)  # the backend doing its work
    _lb.finish(name)
    resp = jsonify({"server": name, "algo": algo, "client": client, "inflight_at_pick": inflight_seen})
    resp.headers["X-Server"] = name
    return resp, 200


@net_lab_bp.route("/lb/servers", methods=["GET"])
def lb_servers():
    return jsonify(_lb.servers), 200


@net_lab_bp.route("/lb/servers/<name>", methods=["PATCH"])
@snippet("net.health")
def set_health(name):
    if name not in _lb.servers:
        return jsonify({"error": "unknown server"}), 404
    data = request.get_json(silent=True) or {}
    if "healthy" in data:
        _lb.servers[name]["healthy"] = bool(data["healthy"])  # what a failed health check flips
    return jsonify(_lb.servers), 200


@net_lab_bp.route("/reset", methods=["POST"])
def reset():
    global _lb
    _lb = LoadBalancer()
    _flaky["outage"] = False
    return jsonify({"servers": _lb.servers, "outage": False}), 200


@net_lab_bp.route("/flaky", methods=["GET"])
@snippet("net.flaky")
def flaky():
    """Fails `fail_rate` of the time with a 503 and is sometimes slower than any sane timeout."""
    fail_rate = float(request.args.get("fail_rate", 0.5))
    slow_rate = float(request.args.get("slow_rate", 0.15))
    if _flaky["outage"] or random.random() < fail_rate:
        return jsonify({"error": "upstream temporarily unavailable"}), 503
    if random.random() < slow_rate:
        time.sleep(3)  # longer than the client's timeout -> client aborts
    return jsonify({"ok": True, "seats_left": random.randint(1, 500)}), 200


@net_lab_bp.route("/outage", methods=["POST"])
def outage():
    _flaky["outage"] = bool((request.get_json(silent=True) or {}).get("down"))
    return jsonify(_flaky), 200


@net_lab_bp.route("/ping", methods=["GET"])
@snippet("net.ping")
def ping():
    """A payload of configurable size, to watch transfer time grow in the waterfall."""
    kb = min(2048, max(0, int(request.args.get("kb", 1))))
    return jsonify({"pong": True, "padding": "x" * (kb * 1024)}), 200
