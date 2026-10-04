import os
import time

from flask import Flask, g
from flask_cors import CORS

from models import db
from routes.venues import venues_bp
from routes.shows import shows_bp
from routes.tickets import tickets_bp
from routes.meta import meta_bp
from routes.lab_cache import cache_lab_bp
from routes.lab_ring import ring_lab_bp
from routes.lab_shard import shard_lab_bp
from routes.lab_cap import cap_lab_bp
from routes.lab_api import api_v2_bp, api_lab_bp
from routes.lab_network import net_lab_bp
from routes.lab_data import data_lab_bp

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Custom headers the labs use to explain what happened server-side. Browsers hide
# non-standard response headers from fetch() unless CORS explicitly exposes them.
EXPOSED_HEADERS = [
    "X-Cache",
    "X-Shard",
    "X-Server",
    "X-Replica",
    "X-Response-Time",
    "X-RateLimit-Remaining",
    "Retry-After",
    "X-Idempotent-Replay",
]


def create_app():
    app = Flask(__name__)
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///" + os.path.join(BASE_DIR, "ticketmaster.db")
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    db.init_app(app)
    CORS(app, origins=["http://localhost:5173"], expose_headers=EXPOSED_HEADERS)

    for bp in (
        venues_bp,
        shows_bp,
        tickets_bp,
        meta_bp,
        cache_lab_bp,
        ring_lab_bp,
        shard_lab_bp,
        cap_lab_bp,
        api_v2_bp,
        api_lab_bp,
        net_lab_bp,
        data_lab_bp,
    ):
        app.register_blueprint(bp)

    @app.before_request
    def start_timer():
        g.start_time = time.perf_counter()

    @app.after_request
    def add_timing_headers(response):
        elapsed_ms = (time.perf_counter() - g.get("start_time", time.perf_counter())) * 1000
        response.headers["X-Response-Time"] = f"{elapsed_ms:.1f}ms"
        # Lets the browser's Resource Timing API see DNS/TCP/TTFB for cross-origin calls.
        response.headers["Timing-Allow-Origin"] = "*"
        return response

    @app.route("/")
    def home():
        return "Ticketmaster REST API is running."

    with app.app_context():
        db.create_all()

    return app


app = create_app()


if __name__ == "__main__":
    app.run(debug=True, threaded=True)
