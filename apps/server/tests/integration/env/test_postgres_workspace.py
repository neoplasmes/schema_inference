from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from psycopg import connect
from psycopg.errors import UniqueViolation

from app.ports.repos.workspace import WorkspaceError
from core.entities.schema_draft import SchemaGraph
from env.config import load_settings
from env.uow.workspace import PostgresWorkspaceUow


def test_database_url_configures_persistent_storage(monkeypatch, tmp_path):
    database_url = "postgresql://workspace:workspace@127.0.0.1:6432/test_workspace"
    monkeypatch.setenv("DATABASE_URL", database_url)
    settings = load_settings(tmp_path / "missing.env")

    assert settings.database_url == database_url


def store(database_url):
    persistence = PostgresWorkspaceUow(database_url)
    persistence.initialize()

    return persistence


def test_storage_configuration_does_not_connect_before_initialization():
    PostgresWorkspaceUow("postgresql://unused:unused@127.0.0.1:1/unused")


def test_concurrent_startups_apply_schema_once(database_url):
    ready = Barrier(4)

    def initialize():
        ready.wait(timeout=10)
        PostgresWorkspaceUow(database_url).initialize()

    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = [executor.submit(initialize) for _ in range(4)]

        for future in futures:
            future.result(timeout=15)

    with store(database_url).read() as repository:
        assert repository.resources("schema") == []


def test_startup_rejects_an_unknown_migration_version(database_url):
    persistence = store(database_url)

    with connect(database_url, prepare_threshold=None) as connection:
        connection.execute("UPDATE workspace_migrations SET version=2")

    with pytest.raises(RuntimeError, match="Unsupported workspace database migrations"):
        persistence.initialize()


def test_reopening_database_keeps_json_and_ordered_revision(database_url):
    first = store(database_url)
    manifest = {
        "snapshot": {"id": "schema-1", "revision": "s1"},
        "rootNodeId": "root",
        "profile": {"syntax": "json"},
        "title": "Книга ' \" %s",
    }
    graph = SchemaGraph(
        "root",
        {"syntax": "json"},
        {"root": {"id": "root", "kind": "object"}},
        {"properties": [{"id": "z"}, {"id": "a"}], "empty": []},
    )

    with first.transaction() as repository:
        repository.put_resource("schema", {"id": "schema-1", "revision": "s1"})
        repository.save_revision(manifest, graph)

    reopened = store(database_url)

    with reopened.read() as repository:
        assert repository.manifest("schema-1", "s1") == manifest
        assert repository.graph("schema-1", "s1") == graph
        assert repository.page("schema-1", "s1", "properties", 1, 1) == (
            [{"id": "a"}],
            2,
        )
        assert repository.page("schema-1", "s1", "empty", 0, 10) == ([], 0)


def test_failed_transaction_rolls_back_resources_and_idempotency(database_url):
    persistence = store(database_url)

    with pytest.raises(RuntimeError, match="interrupted"):
        with persistence.transaction() as repository:
            repository.replay("analyses", "request", "digest")
            repository.put_resource("analysis", {"id": "analysis-1"})
            repository.remember("analyses", "request", "digest", "analysis-1")
            raise RuntimeError("interrupted")

    with persistence.transaction() as repository:
        assert repository.replay("analyses", "request", "digest") is None
        assert repository.resources("analysis") == []


def test_duplicate_revision_keeps_original_and_rolls_back_resource(database_url):
    persistence = store(database_url)
    manifest = {
        "snapshot": {"id": "schema-1", "revision": "s1"},
        "rootNodeId": "root",
        "profile": {"syntax": "json"},
        "title": "Original",
    }
    graph = SchemaGraph(
        "root", {"syntax": "json"}, {"root": {"id": "root", "kind": "object"}}, {}
    )

    with persistence.transaction() as repository:
        repository.put_resource("schema", {"id": "schema-1", "title": "Original"})
        repository.save_revision(manifest, graph)

    with pytest.raises(UniqueViolation):
        with persistence.transaction() as repository:
            repository.put_resource("schema", {"id": "schema-1", "title": "Changed"})
            repository.save_revision({**manifest, "title": "Changed"}, graph)

    with persistence.read() as repository:
        assert repository.resource("schema", "schema-1")["title"] == "Original"
        assert repository.manifest("schema-1", "s1")["title"] == "Original"


def test_read_keeps_one_snapshot_while_another_transaction_commits(database_url):
    persistence = store(database_url)

    with persistence.transaction() as repository:
        repository.put_resource("schema", {"id": "schema-1", "revision": "s1"})

    with persistence.read() as reader:
        assert reader.resource("schema", "schema-1")["revision"] == "s1"

        with persistence.transaction() as writer:
            writer.put_resource("schema", {"id": "schema-1", "revision": "s2"})

        assert reader.resource("schema", "schema-1")["revision"] == "s1"

    with persistence.read() as reader:
        assert reader.resource("schema", "schema-1")["revision"] == "s2"


def test_concurrent_resource_updates_do_not_lose_changes(database_url):
    persistence = store(database_url)
    ready = Barrier(8)

    with persistence.transaction() as repository:
        repository.put_resource("schema", {"id": "schema-1", "count": 0})

    def increment():
        ready.wait(timeout=10)

        with persistence.transaction() as repository:
            resource = repository.resource("schema", "schema-1")
            resource["count"] += 1
            repository.put_resource("schema", resource)

    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = [executor.submit(increment) for _ in range(8)]

        for future in futures:
            future.result(timeout=15)

    with persistence.read() as repository:
        assert repository.resource("schema", "schema-1")["count"] == 8


def test_unrelated_resource_writes_do_not_wait_for_each_other(database_url):
    persistence = store(database_url)

    with persistence.transaction() as repository:
        repository.put_resource("schema", {"id": "first", "count": 0})
        repository.put_resource("schema", {"id": "second", "count": 0})

    def update_other():
        with persistence.transaction() as repository:
            resource = repository.resource("schema", "second")
            repository.put_resource("schema", {**resource, "count": 1})

    with ThreadPoolExecutor(max_workers=1) as executor:
        with persistence.transaction() as repository:
            repository.resource("schema", "first")
            executor.submit(update_other).result(timeout=5)


def test_concurrent_replays_create_one_resource(database_url):
    persistence = store(database_url)
    ready = Barrier(8)

    def create(index):
        ready.wait(timeout=10)

        with persistence.transaction() as repository:
            identifier = repository.replay("analyses", "request", "digest")

            if identifier is None:
                identifier = f"analysis-{index}"
                repository.put_resource("analysis", {"id": identifier})
                repository.remember("analyses", "request", "digest", identifier)

            return identifier

    with ThreadPoolExecutor(max_workers=8) as executor:
        identifiers = list(executor.map(create, range(8)))

    assert len(set(identifiers)) == 1

    with persistence.read() as repository:
        assert repository.resources("analysis") == [{"id": identifiers[0]}]

    with pytest.raises(WorkspaceError) as error:
        with persistence.transaction() as repository:
            repository.replay("analyses", "request", "different")

    assert error.value.code == "idempotency_conflict"
