from flask import Blueprint, jsonify, request

from models import Show, Ticket, db

tickets_bp = Blueprint("tickets", __name__, url_prefix="/api/tickets")


@tickets_bp.route("", methods=["GET"])
def list_tickets():
    tickets = Ticket.query.all()
    return jsonify([t.to_dict() for t in tickets]), 200


@tickets_bp.route("/<int:ticket_id>", methods=["GET"])
def get_ticket(ticket_id):
    ticket = Ticket.query.get(ticket_id)
    if ticket is None:
        return jsonify({"error": "Ticket not found"}), 404
    return jsonify(ticket.to_dict()), 200


@tickets_bp.route("", methods=["POST"])
def create_ticket():
    data = request.get_json(silent=True) or {}
    required = ("seat_section", "price", "show_id")
    if not all(data.get(field) is not None for field in required):
        return jsonify({"error": "seat_section, price, and show_id are required"}), 400

    if Show.query.get(data["show_id"]) is None:
        return jsonify({"error": "show_id does not reference an existing show"}), 400

    ticket = Ticket(
        seat_section=data["seat_section"],
        price=data["price"],
        show_id=data["show_id"],
        status=data.get("status", "available"),
        buyer_name=data.get("buyer_name"),
    )
    db.session.add(ticket)
    db.session.commit()
    return jsonify(ticket.to_dict()), 201


@tickets_bp.route("/<int:ticket_id>", methods=["PUT"])
def replace_ticket(ticket_id):
    """Full replace: every field must be supplied, matching PUT semantics."""
    ticket = Ticket.query.get(ticket_id)
    if ticket is None:
        return jsonify({"error": "Ticket not found"}), 404

    data = request.get_json(silent=True) or {}
    required = ("seat_section", "price", "status", "show_id")
    if not all(data.get(field) is not None for field in required):
        return jsonify({"error": "seat_section, price, status, and show_id are required"}), 400

    if Show.query.get(data["show_id"]) is None:
        return jsonify({"error": "show_id does not reference an existing show"}), 400

    ticket.seat_section = data["seat_section"]
    ticket.price = data["price"]
    ticket.status = data["status"]
    ticket.show_id = data["show_id"]
    ticket.buyer_name = data.get("buyer_name")
    db.session.commit()
    return jsonify(ticket.to_dict()), 200


@tickets_bp.route("/<int:ticket_id>", methods=["PATCH"])
def update_ticket_status(ticket_id):
    """Partial update: only the fields present in the body are changed."""
    ticket = Ticket.query.get(ticket_id)
    if ticket is None:
        return jsonify({"error": "Ticket not found"}), 404

    data = request.get_json(silent=True) or {}
    if not data:
        return jsonify({"error": "Provide at least one field to update"}), 400

    if "status" in data:
        ticket.status = data["status"]
    if "buyer_name" in data:
        ticket.buyer_name = data["buyer_name"]
    if "price" in data:
        ticket.price = data["price"]

    db.session.commit()
    return jsonify(ticket.to_dict()), 200


@tickets_bp.route("/<int:ticket_id>", methods=["DELETE"])
def delete_ticket(ticket_id):
    ticket = Ticket.query.get(ticket_id)
    if ticket is None:
        return jsonify({"error": "Ticket not found"}), 404

    db.session.delete(ticket)
    db.session.commit()
    return jsonify({"message": f"Ticket {ticket_id} deleted"}), 200
