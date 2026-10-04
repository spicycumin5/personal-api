"""Registry of code the frontend can display in the transaction log.

Lab routes tag themselves with @snippet("key"); /api/meta/snippet/<key> then
returns the live source via inspect.getsource, so what the UI shows is always
exactly what ran (unlike the hand-copied snippets.js for the CRUD routes).
"""

import inspect
import textwrap

_REGISTRY = {}


def snippet(key, *extra):
    """Decorator: register the decorated function (plus any helper callables in
    `extra`, e.g. the engine method that does the real work) under `key`."""

    def wrap(fn):
        _REGISTRY[key] = (fn, *extra)
        return fn

    return wrap


def get_source(key):
    parts = _REGISTRY.get(key)
    if parts is None:
        return None
    chunks = []
    for obj in parts:
        path = inspect.getsourcefile(obj) or ""
        rel = path.replace("\\", "/").split("/")[-2:]
        chunks.append(f"# {'/'.join(rel)}\n" + textwrap.dedent(inspect.getsource(obj)).rstrip())
    return "\n\n".join(chunks)


def keys():
    return sorted(_REGISTRY)
