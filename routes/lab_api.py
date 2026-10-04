"""API design patterns, layered on as a /api/v2 alongside the untouched v1 routes.

- Versioning + embedded resources + sparse fieldsets  (GET /api/v2/shows/<id>?fields=)
- Consistent error envelope                          ({"error": {"code", "message"}})
- Cursor pagination                                  (GET /api/v2/tickets?limit=&cursor=)
- Auth (bearer token) + role-based access control    (orders endpoints)
- Idempotency keys                                    (POST /api/v2/orders)
- Token-bucket rate limiting                          (POST /api/v2/orders)

Orders are kept in memory so the demo never charges or deletes real data.
"""

import base64
import itertools
import json
import threading
import time

from flask import Blueprint, jsonify, request

from labs.snippets import snippet
from models import Show, Ticket, Venue

api_v2_bp = Blueprint("api_v2", __name__, url_prefix="/api/v2")
api_lab_bp = Blueprint("api_lab", __name__, url_prefix="/api/lab/api")

TOKENS = {
    "fan-token": {"user": "alice", "role": "fan"},
    "fan2-token": {"user": "bob", "role": "fan"},
    "admin-token": {"user": "ops", "role": "admin"},
}


def error(status, code, message, **details):
    """Every v2 error has the same shape: machine-readable code + human message."""
    body = {"error": {"code": code, "message": message}}
    if details:
        body["error"]["details"] = details
    return jsonify(body), status


# ---------- auth ----------


def current_user():
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return None
    return TOKENS.get(header.removeprefix("Bearer ").strip())


# ---------- rate limiting ----------


class TokenBucket:
    """Each caller gets `capacity` tokens that refill at `rate` per second."""

    def __init__(self, capacity=5, rate=0.5):
        self.capacity = capacity
        self.rate = rate
        self.buckets = {}  # caller -> (tokens, last_refill)
        self._lock = threading.Lock()

    def take(self, caller):
        with self._lock:
            tokens, last = self.buckets.get(caller, (self.capacity, time.time()))
            now = time.time()
            tokens = min(self.capacity, tokens + (now - last) * self.rate)
            if tokens < 1:
                self.buckets[caller] = (tokens, now)
                retry_after = (1 - tokens) / self.rate
                return False, 0, retry_after
            self.buckets[caller] = (tokens - 1, now)
            return True, int(tokens - 1), 0

    def peek(self, caller):
        tokens, last = self.buckets.get(caller, (self.capacity, time.time()))
        return round(min(self.capacity, tokens + (time.time() - last) * self.rate), 2)


# ---------- in-memory orders + idempotency store ----------

_state_lock = threading.Lock()
_orders = []
_order_ids = itertools.count(1)
_idempotency = {}  # (user, key) -> (status, body)
_bucket = TokenBucket()


def _reset_state():
    global _orders, _order_ids, _idempotency, _bucket
    _orders, _order_ids, _idempotency, _bucket = [], itertools.count(1), {}, TokenBucket()


# ---------- versioned, embedded reads ----------


def _show_v2(show):
    venue = Venue.query.get(show.venue_id)
    tickets = Ticket.query.filter_by(show_id=show.id).all()
    return {
        "id": show.id,
        "title": show.title,
        "artist": show.artist,
        "date": show.date,
        "venue": {"id": venue.id, "name": venue.name, "city": venue.city} if venue else None,
        "tickets": {
            "total": len(tickets),
            "available": sum(1 for t in tickets if t.status == "available"),
            "min_price": min((t.price for t in tickets), default=None),
        },
    }


def _pick_fields(obj, fields):
    """?fields=title,venue.name -> only those (dotted paths reach into embedded objects)."""
    out = {}
    for path in fields:
        src, dst, parts = obj, out, path.split(".")
        for i, part in enumerate(parts):
            if not isinstance(src, dict) or part not in src:
                break
            if i == len(parts) - 1:
                dst[part] = src[part]
            else:
                src = src[part]
                dst = dst.setdefault(part, {})
    return out


@api_v2_bp.route("/shows/<int:show_id>", methods=["GET"])
@snippet("v2.show", _show_v2, _pick_fields)
def get_show_v2(show_id):
    show = Show.query.get(show_id)
    if show is None:
        return error(404, "SHOW_NOT_FOUND", f"No show with id {show_id}", show_id=show_id)
    body = _show_v2(show)
    if request.args.get("fields"):
        body = _pick_fields(body, [f.strip() for f in request.args["fields"].split(",") if f.strip()])
    return jsonify(body), 200


# ---------- cursor pagination over real tickets ----------


def _encode_cursor(last_id):
    return base64.urlsafe_b64encode(json.dumps({"after_id": last_id}).encode()).decode()


def _decode_cursor(cursor):
    return json.loads(base64.urlsafe_b64decode(cursor.encode()))["after_id"]


@api_v2_bp.route("/tickets", methods=["GET"])
@snippet("v2.tickets")
def list_tickets_v2():
    limit = min(50, max(1, int(request.args.get("limit", 2))))
    query = Ticket.query.order_by(Ticket.id)
    if request.args.get("cursor"):
        try:
            query = query.filter(Ticket.id > _decode_cursor(request.args["cursor"]))
        except Exception:
            return error(400, "BAD_CURSOR", "cursor is not a value this API issued")
    page = query.limit(limit + 1).all()  # fetch one extra to know if there's a next page
    has_more = len(page) > limit
    page = page[:limit]
    return (
        jsonify(
            {
                "data": [t.to_dict() for t in page],
                "next_cursor": _encode_cursor(page[-1].id) if has_more else None,
            }
        ),
        200,
    )


# ---------- orders: auth, RBAC, idempotency, rate limit ----------


@api_v2_bp.route("/orders", methods=["POST"])
@snippet("v2.orders.create", TokenBucket.take)
def create_order():
    user = current_user()
    if user is None:
        return error(401, "UNAUTHENTICATED", "Send Authorization: Bearer <token>")

    allowed, remaining, retry_after = _bucket.take(user["user"])
    if not allowed:
        resp, status = error(429, "RATE_LIMITED", "Too many purchase attempts; slow down")
        resp.headers["Retry-After"] = f"{retry_after:.1f}"
        resp.headers["X-RateLimit-Remaining"] = "0"
        return resp, status

    data = request.get_json(silent=True) or {}
    show = Show.query.get(data.get("show_id") or 0)
    if show is None:
        return error(400, "INVALID_SHOW", "show_id must reference an existing show")
    quantity = int(data.get("quantity", 1))

    key = request.headers.get("Idempotency-Key")
    # Check-and-store must be atomic: two simultaneous retries with the same key
    # would otherwise both see "not seen yet" and both charge.
    with _state_lock:
        if key and (user["user"], key) in _idempotency:
            status, body = _idempotency[(user["user"], key)]
            resp = jsonify(body)
            resp.headers["X-Idempotent-Replay"] = "true"  # same answer, no second charge
            resp.headers["X-RateLimit-Remaining"] = str(remaining)
            return resp, status

        order = {
            "id": next(_order_ids),
            "user": user["user"],
            "show_id": show.id,
            "show_title": show.title,
            "quantity": quantity,
            "charged": round(quantity * float(data.get("unit_price", 150)), 2),
            "created_at": round(time.time(), 2),
        }
        _orders.append(order)
        if key:
            _idempotency[(user["user"], key)] = (201, order)
    resp = jsonify(order)
    resp.headers["X-RateLimit-Remaining"] = str(remaining)
    return resp, 201


@api_v2_bp.route("/orders", methods=["GET"])
@snippet("v2.orders.list")
def list_orders():
    user = current_user()
    if user is None:
        return error(401, "UNAUTHENTICATED", "Send Authorization: Bearer <token>")
    # Authorization: fans see only their own orders, admins see everything.
    visible = _orders if user["role"] == "admin" else [o for o in _orders if o["user"] == user["user"]]
    return jsonify({"as": user, "data": visible}), 200


@api_v2_bp.route("/orders/<int:order_id>", methods=["DELETE"])
@snippet("v2.orders.refund")
def refund_order(order_id):
    user = current_user()
    if user is None:
        return error(401, "UNAUTHENTICATED", "Send Authorization: Bearer <token>")
    if user["role"] != "admin":
        return error(403, "FORBIDDEN", "Only admins can refund orders", your_role=user["role"])
    with _state_lock:
        order = next((o for o in _orders if o["id"] == order_id), None)
        if order is None:
            return error(404, "ORDER_NOT_FOUND", f"No order with id {order_id}")
        _orders.remove(order)
    return jsonify({"refunded": order}), 200


# ---------- lab-only helpers ----------

_feed = []
_feed_ids = itertools.count(1)


def _seed_feed(n=40):
    global _feed, _feed_ids
    _feed_ids = itertools.count(1)
    _feed = [{"id": next(_feed_ids), "listing": f"Resale listing #{i + 1}"} for i in range(n)]


_seed_feed()


@api_lab_bp.route("/reset", methods=["POST"])
def reset():
    _reset_state()
    _seed_feed()
    return jsonify({"message": "orders, idempotency keys, rate limits and feed reset"}), 200


@api_lab_bp.route("/bucket", methods=["GET"])
def bucket():
    user = current_user()
    caller = user["user"] if user else None
    return (
        jsonify(
            {
                "caller": caller,
                "tokens": _bucket.peek(caller) if caller else None,
                "capacity": _bucket.capacity,
                "refill_per_sec": _bucket.rate,
            }
        ),
        200,
    )


@api_lab_bp.route("/feed", methods=["GET"])
@snippet("api.feed")
def feed():
    """A newest-first resale feed, paginated two different ways."""
    newest_first = sorted(_feed, key=lambda r: -r["id"])
    limit = min(20, max(1, int(request.args.get("limit", 5))))
    if request.args.get("mode") == "cursor":
        before = request.args.get("cursor")
        rows = [r for r in newest_first if before is None or r["id"] < int(before)][:limit]
        return jsonify({"data": rows, "next_cursor": rows[-1]["id"] if rows else None}), 200
    offset = int(request.args.get("offset", 0))
    rows = newest_first[offset : offset + limit]
    return jsonify({"data": rows, "next_offset": offset + limit}), 200


@api_lab_bp.route("/feed", methods=["POST"])
def feed_insert():
    count = min(10, max(1, int((request.get_json(silent=True) or {}).get("count", 2))))
    new = [{"id": next(_feed_ids), "listing": "NEW listing (posted mid-scroll)"} for _ in range(count)]
    _feed.extend(new)
    return jsonify({"inserted": new}), 201
