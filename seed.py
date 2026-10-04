"""Populate ticketmaster.db with a few sample rows so the UI isn't empty on first run."""

from models import Venue, Show, Ticket, db


def seed_if_empty():
    """Insert sample rows unless the database already has data. Needs an app context."""
    if Venue.query.first() is not None:
        return False

    madison_square_garden = Venue(name="Madison Square Garden", city="New York", capacity=20000)
    the_forum = Venue(name="The Forum", city="Los Angeles", capacity=17500)
    db.session.add_all([madison_square_garden, the_forum])
    db.session.commit()

    show_one = Show(title="World Tour Night 1", artist="The Wavelengths", date="2026-03-14", venue_id=madison_square_garden.id)
    show_two = Show(title="Acoustic Evening", artist="Clara Finch", date="2026-04-02", venue_id=the_forum.id)
    db.session.add_all([show_one, show_two])
    db.session.commit()

    tickets = [
        Ticket(seat_section="Floor A", price=150.0, status="available", show_id=show_one.id),
        Ticket(seat_section="Balcony", price=75.0, status="available", show_id=show_one.id),
        Ticket(seat_section="Floor B", price=120.0, status="sold", buyer_name="Jordan Lee", show_id=show_two.id),
    ]
    db.session.add_all(tickets)
    db.session.commit()
    return True


if __name__ == "__main__":
    from main import create_app

    with create_app().app_context():
        if seed_if_empty():
            print("Seeded 2 venues, 2 shows, 3 tickets.")
        else:
            print("Database already has data, skipping seed.")
