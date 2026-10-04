from flask import Blueprint, jsonify, request

from labs.seed_data import ticket_snapshot
from labs.shard_engine import SHARD_KEYS, STRATEGIES, ShardCluster, moved_pct
from labs.snippets import snippet

shard_lab_bp = Blueprint("shard_lab", __name__, url_prefix="/api/lab/shard")

_cluster = None


def cluster():
    global _cluster
    if _cluster is None:
        rows, mega = ticket_snapshot()
        _cluster = ShardCluster(rows, mega)
    return _cluster


@shard_lab_bp.route("/state", methods=["GET"])
def state():
    return jsonify(cluster().state()), 200


@shard_lab_bp.route("/reset", methods=["POST"])
def reset():
    global _cluster
    _cluster = None
    return jsonify(cluster().state()), 200


@shard_lab_bp.route("/configure", methods=["POST"])
@snippet("shard.configure", ShardCluster.reconfigure, ShardCluster._build, ShardCluster.route)
def configure():
    data = request.get_json(silent=True) or {}
    c = cluster()
    strategy = data.get("strategy", c.strategy)
    shard_key = data.get("shard_key", c.shard_key)
    num_shards = int(data.get("num_shards", c.num_shards))
    if strategy not in STRATEGIES:
        return jsonify({"error": f"strategy must be one of {STRATEGIES}"}), 400
    if shard_key not in SHARD_KEYS:
        return jsonify({"error": f"shard_key must be one of {SHARD_KEYS}"}), 400
    if not 1 <= num_shards <= 12:
        return jsonify({"error": "num_shards must be between 1 and 12"}), 400

    before = c.reconfigure(strategy, shard_key, num_shards)
    return jsonify({**c.state(), "rows_moved_pct": moved_pct(before, c.placement)}), 200


@shard_lab_bp.route("/query", methods=["GET"])
@snippet("shard.query", ShardCluster.query_by_show, ShardCluster.query_by_ticket)
def query():
    c = cluster()
    if request.args.get("show_id"):
        result = c.query_by_show(int(request.args["show_id"]))
    elif request.args.get("ticket_id"):
        result = c.query_by_ticket(int(request.args["ticket_id"]))
    else:
        return jsonify({"error": "pass show_id or ticket_id"}), 400
    resp = jsonify(result)
    resp.headers["X-Shard"] = ",".join(str(s) for s in result["shards_touched"])
    return resp, 200


@shard_lab_bp.route("/traffic", methods=["POST"])
@snippet("shard.traffic", ShardCluster.traffic)
def traffic():
    data = request.get_json(silent=True) or {}
    requests_n = min(50000, max(100, int(data.get("requests", 5000))))
    return jsonify(cluster().traffic(requests_n)), 200
