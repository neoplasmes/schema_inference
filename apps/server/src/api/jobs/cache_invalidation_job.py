import logging
from threading import Event, Thread

from app.use_cases.dispatch_changes import DispatchChanges

logger = logging.getLogger(__name__)

BATCH_SIZE = 100


class CacheInvalidationJob:
    """Drain the change outbox periodically and on demand, backing off on failures."""

    def __init__(
        self,
        dispatch: DispatchChanges,
        interval: float = 2.0,
        max_delay: float = 60.0,
    ) -> None:
        self._dispatch = dispatch
        self._interval = interval
        self._max_delay = max_delay
        self._wake = Event()
        self._stopped = Event()
        self._thread: Thread | None = None

    def start(self) -> None:
        self._stopped.clear()
        self._thread = Thread(target=self._run, name="cache-invalidation", daemon=True)
        self._thread.start()

    def kick(self) -> None:
        """Ask the worker to drain the outbox now instead of at the next tick."""
        self._wake.set()

    def stop(self) -> None:
        self._stopped.set()
        self._wake.set()

        if self._thread is not None:
            self._thread.join()
            self._thread = None

    def _run(self) -> None:
        delay = self._interval

        while not self._stopped.is_set():
            self._wake.wait(self._interval)
            self._wake.clear()

            if self._stopped.is_set():
                break

            try:
                while self._dispatch.execute(BATCH_SIZE) >= BATCH_SIZE:
                    continue

                delay = self._interval
            except Exception:
                logger.exception("Cache invalidation failed; retrying in %ss", delay)
                self._stopped.wait(delay)
                delay = min(delay * 2, self._max_delay)
