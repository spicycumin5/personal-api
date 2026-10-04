import time

from flask import Blueprint, jsonify, request

from labs.cache_engine import POLICIES, STRATEGIES, CacheEngine
from labs.seed_data import show_snapshot
from labs.snippets import snippet

cache_lab_bp = Blueprint("cache_lab", __name__, url_prefix="/api/lab/cache")

_engine = None


def engine():
    global _engine
    if _engine is None:
        _engine = CacheEngine(show_snapshot(min_count=10))
    return _engine


@cache_lab_bp.route("/state", methods=["GET"])
def state():
    return jsonify(engine().state()), 200


@cache_lab_bp.route("/reset", methods=["POST"])
def reset():
    global _engine
    old = _engine
    _engine = None
    if old is not None:
        old.crash()  # cancels any pending flush timer
    return jsonify(engine().state()), 200


@cache_lab_bp.route("/config", methods=["POST"])
@snippet("cache.config", CacheEngine._evict)
def configure():
    data = request.get_json(silent=True) or {}
    e = engine()
    if data.get("policy") and data["policy"] not in POLICIES:
        return jsonify({"error": f"policy must be one of {POLICIES}"}), 400
    e.policy = data.get("policy", e.policy)
    e.capacity = max(1, int(data.get("capacity", e.capacity)))
    e.ttl = max(0, int(data.get("ttl", e.ttl)))
    e.origin.latency_ms = max(0, int(data.get("db_latency_ms", e.origin.latency_ms)))
    while len(e.entries) > e.capacity:
        e._evict()
    return jsonify(e.state()), 200


@cache_lab_bp.route("/shows/<int:show_id>", methods=["GET"])
@snippet("cache.read", CacheEngine.get)
def read_show(show_id):
    e = engine()
    started = time.perf_counter()
    value, status = e.get(show_id)
    if value is None:
        return jsonify({"error": "Show not found"}), 404
    resp = jsonify(
        {
            "show": value,
            "cache": status,
            "stale": value != e.origin.peek(show_id),
            "elapsed_ms": round((time.perf_counter() - started) * 1000, 1),
            "evicted": e.last_evicted,
        }
    )
    resp.headers["X-Cache"] = status
    return resp, 200


@cache_lab_bp.route("/shows/<int:show_id>", methods=["PUT"])
@snippet("cache.write", CacheEngine.write)
def write_show(show_id):
    data = request.get_json(silent=True) or {}
    strategy = data.get("strategy")
    if strategy not in STRATEGIES:
        return jsonify({"error": f"strategy must be one of {STRATEGIES}"}), 400
    if not data.get("title"):
        return jsonify({"error": "title is required"}), 400
    e = engine()
    if show_id not in e.origin.rows:
        return jsonify({"error": "Show not found"}), 404
    started = time.perf_counter()
    e.write(show_id, {"title": data["title"]}, strategy)
    return (
        jsonify(
            {
                "strategy": strategy,
                "elapsed_ms": round((time.perf_counter() - started) * 1000, 1),
                "db_row": e.origin.peek(show_id),
                "pending_write_behind": show_id in e.write_behind_queue,
            }
        ),
        200,
    )


@cache_lab_bp.route("/flush", methods=["POST"])
@snippet("cache.flush", CacheEngine.flush)
def flush():
    flushed = engine().flush()
    return jsonify({"flushed": flushed}), 200


@cache_lab_bp.route("/crash", methods=["POST"])
@snippet("cache.crash", CacheEngine.crash)
def crash():
    lost = engine().crash()
    return jsonify({"lost_writes": lost, "message": f"Cache restarted; {len(lost)} unflushed write(s) lost"}), 200


@cache_lab_bp.route("/stampede", methods=["POST"])
@snippet("cache.stampede", CacheEngine.stampede, CacheEngine.get_coalesced)
def stampede():
    data = request.get_json(silent=True) or {}
    e = engine()
    key = int(data.get("key", min(e.origin.rows)))
    concurrency = min(64, max(1, int(data.get("concurrency", 20))))
    return jsonify(e.stampede(key, concurrency, bool(data.get("coalesce")))), 200


@cache_lab_bp.route("/hotkey", methods=["POST"])
@snippet("cache.hotkey", CacheEngine.hot_key_traffic)
def hotkey():
    data = request.get_json(silent=True) or {}
    requests_n = min(20000, max(1, int(data.get("requests", 2000))))
    return jsonify(engine().hot_key_traffic(requests_n, bool(data.get("replicate")))), 200
