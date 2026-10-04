from flask import Blueprint, jsonify, request

from labs.ring_engine import MAX_NODES, HashRing, RingLab, modulo_owner, ring_hash
from labs.snippets import snippet

ring_lab_bp = Blueprint("ring_lab", __name__, url_prefix="/api/lab/ring")

_lab = RingLab()


@ring_lab_bp.route("/state", methods=["GET"])
def state():
    return jsonify(_lab.state()), 200


@ring_lab_bp.route("/reset", methods=["POST"])
def reset():
    global _lab
    _lab = RingLab()
    return jsonify(_lab.state()), 200


@ring_lab_bp.route("/nodes", methods=["POST"])
@snippet("ring.add", HashRing.add_node, RingLab._diff)
def add_node():
    data = request.get_json(silent=True) or {}
    name = data.get("name")
    if name and name in _lab.ring.nodes:
        return jsonify({"error": f"{name} is already on the ring"}), 409
    if len(_lab.ring.nodes) >= MAX_NODES:
        return jsonify({"error": f"This demo caps the ring at {MAX_NODES} nodes"}), 400
    result = _lab.add_node(name)
    return jsonify({**result, "state": _lab.state()}), 201


@ring_lab_bp.route("/nodes/<name>", methods=["DELETE"])
@snippet("ring.remove", HashRing.remove_node, RingLab._diff)
def remove_node(name):
    if name not in _lab.ring.nodes:
        return jsonify({"error": f"{name} is not on the ring"}), 404
    if len(_lab.ring.nodes) == 1:
        return jsonify({"error": "Can't remove the last node"}), 400
    result = _lab.remove_node(name)
    return jsonify({**result, "state": _lab.state()}), 200


@ring_lab_bp.route("/vnodes", methods=["POST"])
def set_vnodes():
    data = request.get_json(silent=True) or {}
    vnodes = min(200, max(1, int(data.get("vnodes", 1))))
    _lab.ring.set_vnodes(vnodes)
    return jsonify(_lab.state()), 200


@ring_lab_bp.route("/lookup", methods=["GET"])
@snippet("ring.lookup", HashRing.lookup, ring_hash)
def lookup():
    key = request.args.get("key", "")
    if not key:
        return jsonify({"error": "key query param is required"}), 400
    node, vnode_pos = _lab.ring.lookup(key)
    return (
        jsonify(
            {
                "key": key,
                "hash": ring_hash(key),
                "node": node,
                "vnode_position": vnode_pos,
                "modulo_node": modulo_owner(key, _lab.ring.nodes),
            }
        ),
        200,
    )
