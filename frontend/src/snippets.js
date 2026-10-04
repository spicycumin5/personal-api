// Hardcoded, kept in sync by hand with routes/*.py — shown next to the live
// request/response so every button press can be traced to the exact backend
// code that handled it.
export const SNIPPETS = {
  "venues.list": `# routes/venues.py
@venues_bp.route("", methods=["GET"])
def list_venues():
    venues = Venue.query.all()
    return jsonify([v.to_dict() for v in venues]), 200`,

  "venues.create": `# routes/venues.py
@venues_bp.route("", methods=["POST"])
def create_venue():
    data = request.get_json(silent=True) or {}
    if not data.get("name") or not data.get("city") or not data.get("capacity"):
        return jsonify({"error": "name, city, and capacity are required"}), 400

    venue = Venue(name=data["name"], city=data["city"], capacity=data["capacity"])
    db.session.add(venue)
    db.session.commit()
    return jsonify(venue.to_dict()), 201`,

  "venues.update": `# routes/venues.py
@venues_bp.route("/<int:venue_id>", methods=["PUT"])
def update_venue(venue_id):
    venue = Venue.query.get(venue_id)
    if venue is None:
        return jsonify({"error": "Venue not found"}), 404
    ...
    venue.name = data["name"]
    venue.city = data["city"]
    venue.capacity = data["capacity"]
    db.session.commit()
    return jsonify(venue.to_dict()), 200`,

  "venues.delete": `# routes/venues.py
@venues_bp.route("/<int:venue_id>", methods=["DELETE"])
def delete_venue(venue_id):
    venue = Venue.query.get(venue_id)
    if venue is None:
        return jsonify({"error": "Venue not found"}), 404

    db.session.delete(venue)
    db.session.commit()
    return jsonify({"message": f"Venue {venue_id} deleted"}), 200`,

  "venues.shows": `# routes/venues.py
@venues_bp.route("/<int:venue_id>/shows", methods=["GET"])
def get_venue_shows(venue_id):
    venue = Venue.query.get(venue_id)
    if venue is None:
        return jsonify({"error": "Venue not found"}), 404
    shows = Show.query.filter_by(venue_id=venue_id).all()
    return jsonify([s.to_dict() for s in shows]), 200`,

  "shows.list": `# routes/shows.py
@shows_bp.route("", methods=["GET"])
def list_shows():
    shows = Show.query.all()
    return jsonify([s.to_dict() for s in shows]), 200`,

  "shows.create": `# routes/shows.py
@shows_bp.route("", methods=["POST"])
def create_show():
    data = request.get_json(silent=True) or {}
    ...
    show = Show(title=data["title"], artist=data["artist"],
                date=data["date"], venue_id=data["venue_id"])
    db.session.add(show)
    db.session.commit()
    return jsonify(show.to_dict()), 201`,

  "shows.update": `# routes/shows.py
@shows_bp.route("/<int:show_id>", methods=["PUT"])
def update_show(show_id):
    show = Show.query.get(show_id)
    if show is None:
        return jsonify({"error": "Show not found"}), 404
    ...
    show.title = data["title"]
    show.artist = data["artist"]
    show.date = data["date"]
    show.venue_id = data["venue_id"]
    db.session.commit()
    return jsonify(show.to_dict()), 200`,

  "shows.delete": `# routes/shows.py
@shows_bp.route("/<int:show_id>", methods=["DELETE"])
def delete_show(show_id):
    show = Show.query.get(show_id)
    if show is None:
        return jsonify({"error": "Show not found"}), 404

    db.session.delete(show)
    db.session.commit()
    return jsonify({"message": f"Show {show_id} deleted"}), 200`,

  "shows.tickets": `# routes/shows.py
@shows_bp.route("/<int:show_id>/tickets", methods=["GET"])
def get_show_tickets(show_id):
    show = Show.query.get(show_id)
    if show is None:
        return jsonify({"error": "Show not found"}), 404
    tickets = Ticket.query.filter_by(show_id=show_id).all()
    return jsonify([t.to_dict() for t in tickets]), 200`,

  "tickets.list": `# routes/tickets.py
@tickets_bp.route("", methods=["GET"])
def list_tickets():
    tickets = Ticket.query.all()
    return jsonify([t.to_dict() for t in tickets]), 200`,

  "tickets.create": `# routes/tickets.py
@tickets_bp.route("", methods=["POST"])
def create_ticket():
    data = request.get_json(silent=True) or {}
    ...
    ticket = Ticket(seat_section=data["seat_section"], price=data["price"],
                     show_id=data["show_id"], status=data.get("status", "available"))
    db.session.add(ticket)
    db.session.commit()
    return jsonify(ticket.to_dict()), 201`,

  "tickets.put": `# routes/tickets.py  (PUT = full replace, every field required)
@tickets_bp.route("/<int:ticket_id>", methods=["PUT"])
def replace_ticket(ticket_id):
    ticket = Ticket.query.get(ticket_id)
    ...
    ticket.seat_section = data["seat_section"]
    ticket.price = data["price"]
    ticket.status = data["status"]
    ticket.show_id = data["show_id"]
    ticket.buyer_name = data.get("buyer_name")
    db.session.commit()
    return jsonify(ticket.to_dict()), 200`,

  "tickets.patch": `# routes/tickets.py  (PATCH = partial update, only sent fields change)
@tickets_bp.route("/<int:ticket_id>", methods=["PATCH"])
def update_ticket_status(ticket_id):
    ticket = Ticket.query.get(ticket_id)
    ...
    if "status" in data:
        ticket.status = data["status"]
    if "buyer_name" in data:
        ticket.buyer_name = data["buyer_name"]
    if "price" in data:
        ticket.price = data["price"]
    db.session.commit()
    return jsonify(ticket.to_dict()), 200`,

  "tickets.delete": `# routes/tickets.py
@tickets_bp.route("/<int:ticket_id>", methods=["DELETE"])
def delete_ticket(ticket_id):
    ticket = Ticket.query.get(ticket_id)
    if ticket is None:
        return jsonify({"error": "Ticket not found"}), 404

    db.session.delete(ticket)
    db.session.commit()
    return jsonify({"message": f"Ticket {ticket_id} deleted"}), 200`,
};
