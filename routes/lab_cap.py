from flask import Blueprint, jsonify, request

from labs.cap_engine import REPLICAS, SEATS, CapCluster, SeatTaken, Unavailable
from labs.snippets import snippet

cap_lab_bp = Blueprint("cap_lab", __name__, url_prefix="/api/lab/cap")

_cluster = CapCluster()


@cap_lab_bp.route("/state", methods=["GET"])
def state():
    return jsonify(_cluster.state()), 200


@cap_lab_bp.route("/reset", methods=["POST"])
def reset():
    global _cluster
    data = request.get_json(silent=True) or {}
    _cluster = CapCluster(mode=data.get("mode", _cluster.mode), lag_ms=_cluster.lag_ms)
    return jsonify(_cluster.state()), 200


@cap_lab_bp.route("/config", methods=["POST"])
def configure():
    data = request.get_json(silent=True) or {}
    if data.get("mode") and data["mode"] not in ("CP", "AP"):
        return jsonify({"error": "mode must be CP or AP"}), 400
    _cluster.mode = data.get("mode", _cluster.mode)
    _cluster.lag_ms = max(0, int(data.get("lag_ms", _cluster.lag_ms)))
    return jsonify(_cluster.state()), 200


@cap_lab_bp.route("/partition", methods=["POST"])
@snippet("cap.partition", CapCluster.group)
def partition():
    data = request.get_json(silent=True) or {}
    _cluster.partition(data.get("isolate", ["eu"]))
    return jsonify(_cluster.state()), 200


@cap_lab_bp.route("/heal", methods=["POST"])
@snippet("cap.heal", CapCluster.heal, CapCluster._apply)
def heal():
    _cluster.heal()
    return jsonify(_cluster.state()), 200


@cap_lab_bp.route("/book", methods=["POST"])
@snippet("cap.book", CapCluster.book)
def book():
    data = request.get_json(silent=True) or {}
    replica, client, seat = data.get("replica"), data.get("client"), data.get("seat")
    if replica not in REPLICAS or seat not in SEATS or not client:
        return jsonify({"error": "replica, client and a valid seat are required"}), 400
    try:
        record = _cluster.book(replica, client, seat)
    except Unavailable as exc:
        resp = jsonify({"error": str(exc), "cap": "chose Consistency over Availability"})
        resp.headers["X-Replica"] = replica
        return resp, 503
    except SeatTaken as exc:
        return jsonify({"error": str(exc)}), 409
    resp = jsonify({"booked": record, "mode": _cluster.mode})
    resp.headers["X-Replica"] = replica
    return resp, 201


@cap_lab_bp.route("/seats", methods=["GET"])
@snippet("cap.read", CapCluster.read)
def read_seats():
    replica = request.args.get("replica", "us-east")
    level = request.args.get("level", "eventual")
    client = request.args.get("client")
    if replica not in REPLICAS or level not in ("strong", "eventual", "read_your_writes"):
        return jsonify({"error": "bad replica or level"}), 400
    try:
        seats, served_by = _cluster.read(replica, level, client)
    except Unavailable as exc:
        return jsonify({"error": str(exc)}), 503
    resp = jsonify({"level": level, "served_by": served_by, "seats": seats})
    resp.headers["X-Replica"] = served_by
    return resp, 200
