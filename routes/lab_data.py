from flask import Blueprint, jsonify, request

from labs.data_engine import DataLab
from labs.snippets import snippet

data_lab_bp = Blueprint("data_lab", __name__, url_prefix="/api/lab/data")

_lab = None


def lab():
    global _lab
    if _lab is None:
        _lab = DataLab()
    return _lab


@data_lab_bp.route("/state", methods=["GET"])
def state():
    return jsonify(lab().state()), 200


@data_lab_bp.route("/generate", methods=["POST"])
@snippet("data.generate", DataLab.generate)
def generate():
    n = min(500000, max(1000, int((request.get_json(silent=True) or {}).get("tickets", 20000))))
    lab().generate(n)
    return jsonify(lab().state()), 201


@data_lab_bp.route("/index", methods=["POST"])
@snippet("data.index", DataLab.set_index)
def set_index():
    lab().set_index(bool((request.get_json(silent=True) or {}).get("on")))
    return jsonify(lab().state()), 200


@data_lab_bp.route("/query", methods=["GET"])
@snippet("data.query", DataLab.tickets_for_show)
def query():
    show_id = int(request.args.get("show_id", 42))
    return jsonify({**lab().tickets_for_show(show_id), "indexed": lab().has_index()}), 200


@data_lab_bp.route("/tickets/<int:ticket_id>", methods=["GET"])
@snippet("data.read", DataLab.read_normalized, DataLab.read_denormalized)
def read_ticket(ticket_id):
    return (
        jsonify(
            {
                "normalized": lab().read_normalized(ticket_id),
                "denormalized": lab().read_denormalized(ticket_id),
            }
        ),
        200,
    )


@data_lab_bp.route("/venues/<int:venue_id>", methods=["PATCH"])
@snippet("data.rename", DataLab.rename_venue)
def rename_venue(venue_id):
    name = (request.get_json(silent=True) or {}).get("name")
    if not name:
        return jsonify({"error": "name is required"}), 400
    return jsonify(lab().rename_venue(venue_id, name)), 200


@data_lab_bp.route("/backfill", methods=["POST"])
@snippet("data.backfill", DataLab.backfill)
def backfill():
    return jsonify(lab().backfill()), 200


@data_lab_bp.route("/documents/<int:show_id>", methods=["GET"])
@snippet("data.document", DataLab.as_document)
def document(show_id):
    doc = lab().as_document(show_id)
    if doc is None:
        return jsonify({"error": "Show not found"}), 404
    return jsonify(doc), 200
