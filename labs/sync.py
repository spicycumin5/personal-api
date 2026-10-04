"""Thread safety for the lab engines.

Flask (threaded=True locally, Fluid compute on Vercel) serves concurrent requests
in one process, so two requests can mutate the same engine at once — e.g. two fans
"simultaneously" booking a seat would both pass the is-it-free check.
"""

import functools


def synchronized(method):
    """Run the method while holding the instance's re-entrant `_lock`."""

    @functools.wraps(method)
    def wrapper(self, *args, **kwargs):
        with self._lock:
            return method(self, *args, **kwargs)

    return wrapper
