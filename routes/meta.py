from flask import Blueprint, current_app, jsonify
from sqlalchemy import inspect as sa_inspect

from labs.snippets import get_source, snippet
from models import db

meta_bp = Blueprint("meta", __name__, url_prefix="/api/meta")


@meta_bp.route("/schema", methods=["GET"])
@snippet("meta.schema")
def schema():
    """Introspect the real SQLAlchemy models: the 'Core Entities' step, live."""
    entities = []
    for mapper in db.Model.registry.mappers:
        table = mapper.local_table
        entities.append(
            {
                "name": mapper.class_.__name__,
                "table": table.name,
                "columns": [
                    {
                        "name": col.name,
                        "type": str(col.type),
                        "primary_key": col.primary_key,
                        "nullable": col.nullable,
                        "foreign_key": next((fk.target_fullname for fk in col.foreign_keys), None),
                    }
                    for col in table.columns
                ],
                "indexes": [
                    {"name": ix.name, "columns": [c.name for c in ix.columns]} for ix in table.indexes
                ],
                "relationships": [
                    {"name": rel.key, "target": rel.mapper.class_.__name__, "direction": rel.direction.name}
                    for rel in sa_inspect(mapper.class_).relationships
                ],
            }
        )
    entities.sort(key=lambda e: e["name"])
    return jsonify(entities), 200


@meta_bp.route("/routes", methods=["GET"])
@snippet("meta.routes")
def routes():
    """Dump Flask's URL map: the 'API' step, live."""
    out = []
    for rule in current_app.url_map.iter_rules():
        if rule.endpoint == "static":
            continue
        methods = sorted(m for m in rule.methods if m not in ("HEAD", "OPTIONS"))
        out.append({"rule": rule.rule, "methods": methods, "endpoint": rule.endpoint})
    out.sort(key=lambda r: r["rule"])
    return jsonify(out), 200


@meta_bp.route("/snippet/<key>", methods=["GET"])
def get_snippet(key):
    source = get_source(key)
    if source is None:
        return jsonify({"error": f"No snippet registered for {key}"}), 404
    return jsonify({"key": key, "source": source}), 200
