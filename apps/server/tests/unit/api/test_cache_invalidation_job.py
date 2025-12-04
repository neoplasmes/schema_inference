from threading import Event
from unittest.mock import Mock

from api.jobs import CacheInvalidationJob


def test_kick_drains_without_waiting_for_the_interval():
    drained = Event()
    dispatch = Mock()
    dispatch.execute.side_effect = lambda limit: drained.set() or 0
    job = CacheInvalidationJob(dispatch, interval=3600)
    job.start()

    try:
        job.kick()

        assert drained.wait(timeout=5)
    finally:
        job.stop()


def test_job_polls_periodically():
    calls = Event()
    dispatch = Mock()
    dispatch.execute.side_effect = lambda limit: calls.set() or 0
    job = CacheInvalidationJob(dispatch, interval=0.01)
    job.start()

    try:
        assert calls.wait(timeout=5)
    finally:
        job.stop()


def test_full_batches_are_drained_until_empty():
    sizes = iter([100, 100, 3])
    done = Event()
    dispatch = Mock()

    def execute(limit):
        size = next(sizes, 0)

        if size < limit:
            done.set()

        return size

    dispatch.execute.side_effect = execute
    job = CacheInvalidationJob(dispatch, interval=3600)
    job.start()

    try:
        job.kick()

        assert done.wait(timeout=5)
        assert dispatch.execute.call_count == 3
    finally:
        job.stop()


def test_failures_are_logged_and_retried(caplog):
    retried = Event()
    dispatch = Mock()
    outcomes = iter([RuntimeError("purge down")])

    def execute(limit):
        error = next(outcomes, None)

        if error is None:
            retried.set()

            return 0

        raise error

    dispatch.execute.side_effect = execute
    job = CacheInvalidationJob(dispatch, interval=0.01, max_delay=0.02)
    job.start()

    try:
        assert retried.wait(timeout=5)
    finally:
        job.stop()

    assert "purge down" in caplog.text
