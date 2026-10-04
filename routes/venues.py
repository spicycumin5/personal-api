from flask import Blueprint, jsonify, request

from models import Venue, Show, db

venues_bp = Blueprint("venues", __name__, url_prefix="/api/venues")


@venues_bp.route("", methods=["GET"])
def list_venues():
    venues = Venue.query.all()
    return jsonify([v.to_dict() for v in venues]), 200


@venues_bp.route("/<int:venue_id>", methods=["GET"])
def get_venue(venue_id):
    venue = Venue.query.get(venue_id)
    if venue is None:
        return jsonify({"error": "Venue not found"}), 404
    return jsonify(venue.to_dict()), 200


@venues_bp.route("/<int:venue_id>/shows", methods=["GET"])
def get_venue_shows(venue_id):
    venue = Venue.query.get(venue_id)
    if venue is None:
        return jsonify({"error": "Venue not found"}), 404
    shows = Show.query.filter_by(venue_id=venue_id).all()
    return jsonify([s.to_dict() for s in shows]), 200


@venues_bp.route("", methods=["POST"])
def create_venue():
    data = request.get_json(silent=True) or {}
    if not data.get("name") or not data.get("city") or not data.get("capacity"):
        return jsonify({"error": "name, city, and capacity are required"}), 400

    venue = Venue(name=data["name"], city=data["city"], capacity=data["capacity"])
    db.session.add(venue)
    db.session.commit()
    return jsonify(venue.to_dict()), 201


@venues_bp.route("/<int:venue_id>", methods=["PUT"])
def update_venue(venue_id):
    venue = Venue.query.get(venue_id)
    if venue is None:
        return jsonify({"error": "Venue not found"}), 404

    data = request.get_json(silent=True) or {}
    if not data.get("name") or not data.get("city") or not data.get("capacity"):
        return jsonify({"error": "name, city, and capacity are required"}), 400

    venue.name = data["name"]
    venue.city = data["city"]
    venue.capacity = data["capacity"]
    db.session.commit()
    return jsonify(venue.to_dict()), 200


@venues_bp.route("/<int:venue_id>", methods=["DELETE"])
def delete_venue(venue_id):
    venue = Venue.query.get(venue_id)
    if venue is None:
        return jsonify({"error": "Venue not found"}), 404

    db.session.delete(venue)
    db.session.commit()
    return jsonify({"message": f"Venue {venue_id} deleted"}), 200
