from flask import Blueprint, jsonify, request

from models import Show, Ticket, Venue, db

shows_bp = Blueprint("shows", __name__, url_prefix="/api/shows")


@shows_bp.route("", methods=["GET"])
def list_shows():
    shows = Show.query.all()
    return jsonify([s.to_dict() for s in shows]), 200


@shows_bp.route("/<int:show_id>", methods=["GET"])
def get_show(show_id):
    show = Show.query.get(show_id)
    if show is None:
        return jsonify({"error": "Show not found"}), 404
    return jsonify(show.to_dict()), 200


@shows_bp.route("/<int:show_id>/tickets", methods=["GET"])
def get_show_tickets(show_id):
    show = Show.query.get(show_id)
    if show is None:
        return jsonify({"error": "Show not found"}), 404
    tickets = Ticket.query.filter_by(show_id=show_id).all()
    return jsonify([t.to_dict() for t in tickets]), 200


@shows_bp.route("", methods=["POST"])
def create_show():
    data = request.get_json(silent=True) or {}
    required = ("title", "artist", "date", "venue_id")
    if not all(data.get(field) for field in required):
        return jsonify({"error": "title, artist, date, and venue_id are required"}), 400

    if Venue.query.get(data["venue_id"]) is None:
        return jsonify({"error": "venue_id does not reference an existing venue"}), 400

    show = Show(
        title=data["title"],
        artist=data["artist"],
        date=data["date"],
        venue_id=data["venue_id"],
    )
    db.session.add(show)
    db.session.commit()
    return jsonify(show.to_dict()), 201


@shows_bp.route("/<int:show_id>", methods=["PUT"])
def update_show(show_id):
    show = Show.query.get(show_id)
    if show is None:
        return jsonify({"error": "Show not found"}), 404

    data = request.get_json(silent=True) or {}
    required = ("title", "artist", "date", "venue_id")
    if not all(data.get(field) for field in required):
        return jsonify({"error": "title, artist, date, and venue_id are required"}), 400

    if Venue.query.get(data["venue_id"]) is None:
        return jsonify({"error": "venue_id does not reference an existing venue"}), 400

    show.title = data["title"]
    show.artist = data["artist"]
    show.date = data["date"]
    show.venue_id = data["venue_id"]
    db.session.commit()
    return jsonify(show.to_dict()), 200


@shows_bp.route("/<int:show_id>", methods=["DELETE"])
def delete_show(show_id):
    show = Show.query.get(show_id)
    if show is None:
        return jsonify({"error": "Show not found"}), 404

    db.session.delete(show)
    db.session.commit()
    return jsonify({"message": f"Show {show_id} deleted"}), 200
