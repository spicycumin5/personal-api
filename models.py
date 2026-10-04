from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


class Venue(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    city = db.Column(db.String(120), nullable=False)
    capacity = db.Column(db.Integer, nullable=False)

    shows = db.relationship("Show", backref="venue", cascade="all, delete-orphan")

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "city": self.city,
            "capacity": self.capacity,
        }


class Show(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(120), nullable=False)
    artist = db.Column(db.String(120), nullable=False)
    date = db.Column(db.String(20), nullable=False)
    venue_id = db.Column(db.Integer, db.ForeignKey("venue.id"), nullable=False)

    tickets = db.relationship("Ticket", backref="show", cascade="all, delete-orphan")

    def to_dict(self):
        return {
            "id": self.id,
            "title": self.title,
            "artist": self.artist,
            "date": self.date,
            "venue_id": self.venue_id,
        }


class Ticket(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    seat_section = db.Column(db.String(60), nullable=False)
    price = db.Column(db.Float, nullable=False)
    status = db.Column(db.String(20), nullable=False, default="available")
    buyer_name = db.Column(db.String(120), nullable=True)
    show_id = db.Column(db.Integer, db.ForeignKey("show.id"), nullable=False)

    def to_dict(self):
        return {
            "id": self.id,
            "seat_section": self.seat_section,
            "price": self.price,
            "status": self.status,
            "buyer_name": self.buyer_name,
            "show_id": self.show_id,
        }
