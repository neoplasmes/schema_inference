import logging
from concurrent.futures import Future
from contextlib import contextmanager
from threading import Event
from typing import Iterator, cast
from unittest.mock import Mock

from app.ports.repos.workspace import WorkspaceRepository
from app.ports.uow.workspace import WorkspaceUow
from app.use_cases.run_analysis import RunAnalysis
from app.use_cases.run_analysis.run_analysis import MAX_ATTEMPTS
from env.tools.analysis_jobs import ThreadedAnalysisJobs


class FakeRepository:
    def __init__(self, resources):
        self.resources = resources

    def resource(self, kind, identifier):
        return self.resources[identifier]

    def put_resource(self, kind, value):
        self.resources[value["id"]] = value

    def pending_analyses(self):
        return sorted(
            key
            for key, value in self.resources.items()
            if value["status"] in ("queued", "processing")
        )


class FakeStore:
    def __init__(self, resources, failure=None):
        self.repository = FakeRepository(resources)
        self.failure = failure

    @contextmanager
    def transaction(self) -> Iterator[WorkspaceRepository]:
        if self.failure is not None:
            raise self.failure

        yield cast(WorkspaceRepository, self.repository)

    read = transaction


def uow(store: FakeStore) -> WorkspaceUow:
    return cast(WorkspaceUow, store)


def analysis(**fields):
    return {
        "id": "a1",
        "status": "processing",
        "documents": [{"format": "json", "content": "{}"}],
        "title": "t",
        "revision": "r",
        **fields,
    }


def test_exhausted_attempts_fail_analysis_without_running():
    store = FakeStore({"a1": analysis(attempts=MAX_ATTEMPTS)})
    reader, inference = Mock(), Mock()

    RunAnalysis(uow(store), reader, inference).execute("a1")

    assert store.repository.resources["a1"]["status"] == "failed"
    assert store.repository.resources["a1"]["progress"] == 100
    reader.read.assert_not_called()
    inference.analyze.assert_not_called()


def test_pending_uses_repository_query():
    store = FakeStore({"a1": analysis(), "a2": analysis(id="a2", status="completed")})

    assert RunAnalysis(uow(store), Mock(), Mock()).pending() == ["a1"]


def test_first_transaction_failure_is_logged(caplog):
    store = FakeStore({}, failure=RuntimeError("db down"))

    with caplog.at_level(logging.ERROR):
        RunAnalysis(uow(store), Mock(), Mock()).execute("a1")

    assert "could not be executed" in caplog.text
    assert "db down" in caplog.text


def test_crashed_job_is_logged_by_done_callback(caplog):
    run = Mock()
    run.execute.side_effect = RuntimeError("boom")
    jobs = ThreadedAnalysisJobs(run)

    with caplog.at_level(logging.ERROR):
        jobs.submit("a1")
        jobs.shutdown()

    assert "boom" in caplog.text


def test_done_callback_ignores_cancelled_future(caplog):
    future = Future()
    future.cancel()

    with caplog.at_level(logging.ERROR):
        ThreadedAnalysisJobs._log_failure(future)

    assert caplog.text == ""


def test_shutdown_cancels_queued_futures():
    started, release = Event(), Event()
    executed = []
    run = Mock()

    def execute(identifier):
        executed.append(identifier)
        started.set()
        release.wait(timeout=5)

    run.execute.side_effect = execute
    jobs = ThreadedAnalysisJobs(run)
    jobs.submit("first")
    started.wait(timeout=5)
    jobs.submit("second")
    release.set()
    jobs.shutdown()

    assert executed == ["first"]
