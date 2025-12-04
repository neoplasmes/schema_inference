from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from psycopg import connect, sql
from psycopg.errors import UniqueViolation

from app.ports.repos.workspace import WorkspaceError
from core.entities import ResourceChange
from core.entities.schema_draft import SchemaGraph
from env.config import load_settings
from env.uow.workspace import PostgresWorkspaceUow


def test_database_url_configures_persistent_storage(monkeypatch, tmp_path):
    database_url = "postgresql://workspace:REDACTED@127.0.0.1:6432/test_workspace"
    monkeypatch.setenv("DATABASE_URL", database_url)
    settings = load_settings(tmp_path / "missing.env")

    assert settings.database_url == database_url


def store(database_url):
    persistence = PostgresWorkspaceUow(database_url)
    persistence.initialize()

    return persistence


def test_storage_configuration_does_not_connect_before_initialization():
    PostgresWorkspaceUow("postgresql://unused:REDACTED@127.0.0.1:1/unused")


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
        connection.execute("UPDATE workspace_migrations SET version=version + 100")

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


def test_pending_analyses_returns_only_queued_and_processing_ids(database_url):
    persistence = store(database_url)

    with persistence.transaction() as repository:
        for identifier, status in [
            ("c", "processing"),
            ("a", "queued"),
            ("b", "completed"),
            ("d", "failed"),
        ]:
            repository.put_resource("analysis", {"id": identifier, "status": status})

        repository.put_resource("schema", {"id": "e", "status": "queued"})

    with persistence.read() as repository:
        assert repository.pending_analyses() == ["a", "c"]


def test_migrations_upgrade_a_database_left_at_the_first_version(database_url):
    migration = PostgresWorkspaceUow._migrations()[0][1]

    with connect(database_url, prepare_threshold=None) as connection:
        connection.execute(
            "CREATE TABLE workspace_migrations "
            "(version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())"
        )
        connection.execute(migration.read_bytes())
        connection.execute("INSERT INTO workspace_migrations (version) VALUES (1)")
        connection.execute(
            "INSERT INTO resources (kind, id, data) VALUES ('schema', 'old', '{}')"
        )

    persistence = store(database_url)
    store(database_url)

    with connect(database_url, prepare_threshold=None) as connection:
        versions = connection.execute(
            "SELECT version FROM workspace_migrations ORDER BY version"
        ).fetchall()

    assert versions == [(1,), (2,)]

    with persistence.read() as repository:
        assert repository.owner("schema", "old") == ""
        assert repository.resources("schema", "someone") == []
        assert repository.resources("schema") == [{}]


def test_startup_rejects_a_gap_in_applied_migrations(database_url):
    persistence = store(database_url)

    with connect(database_url, prepare_threshold=None) as connection:
        connection.execute("DELETE FROM workspace_migrations WHERE version=1")

    with pytest.raises(RuntimeError, match="Unsupported workspace database migrations"):
        persistence.initialize()


def test_owner_filters_listing_and_survives_updates(database_url):
    persistence = store(database_url)

    with persistence.transaction() as repository:
        repository.put_resource("schema", {"id": "a", "n": 1}, "alice")
        repository.put_resource("schema", {"id": "b"}, "bob")
        repository.put_resource("analysis", {"id": "c"}, "alice")
        repository.put_resource("schema", {"id": "a", "n": 2})

    with persistence.read() as repository:
        assert repository.owner("schema", "a") == "alice"
        assert repository.owner("schema", "missing") is None
        assert repository.resources("schema", "alice") == [{"id": "a", "n": 2}]
        assert repository.resources("schema", "bob") == [{"id": "b"}]
        assert repository.resources("schema", "nobody") == []
        assert [item["id"] for item in repository.resources("schema")] == ["a", "b"]


def graph():
    return SchemaGraph(
        "root",
        {"syntax": "json"},
        {"root": {"id": "root", "kind": "object"}},
        {"properties": [{"id": "p"}]},
    )


def schema_manifest(identifier, revision):
    return {
        "snapshot": {"id": identifier, "revision": revision},
        "rootNodeId": "root",
        "profile": {"syntax": "json"},
        "title": identifier,
    }


def test_deleting_a_schema_cascades_and_keeps_other_resources(database_url):
    persistence = store(database_url)

    with persistence.transaction() as repository:
        for identifier in ("keep", "drop"):
            repository.put_resource("schema", {"id": identifier}, "alice")
            repository.save_revision(schema_manifest(identifier, "s1"), graph())
            repository.save_revision(schema_manifest(identifier, "s2"), graph())
            repository.put_receipt(identifier, {"id": "m1"})
            repository.replay(f"changesets:{identifier}", "m1", "d")
            repository.remember(f"changesets:{identifier}", "m1", "d", "m1")
            repository.remember("schemas:alice", f"key-{identifier}", "d", identifier)

    with persistence.transaction() as repository:
        repository.delete_resource("schema", "drop")

    with persistence.read() as repository:
        assert repository.owner("schema", "drop") is None

        with pytest.raises(WorkspaceError):
            repository.manifest("drop", "s1")

        with pytest.raises(WorkspaceError):
            repository.receipt("drop", "m1")

        assert repository.replay("schemas:alice", "key-drop", "other") is None
        assert repository.replay("changesets:drop", "m1", "other") is None
        assert repository.manifest("keep", "s2")["title"] == "keep"
        assert repository.page("keep", "s1", "properties", 0, 10)[1] == 1
        assert repository.receipt("keep", "m1") == {"id": "m1"}

        with pytest.raises(WorkspaceError):
            repository.replay("schemas:alice", "key-keep", "other")

    with connect(database_url, prepare_threshold=None) as connection:
        for table in ("members", "collections", "nodes", "revisions", "changesets"):
            query = sql.SQL("SELECT count(*) FROM {} WHERE schema_id='drop'").format(
                sql.Identifier(table)
            )

            assert connection.execute(query).fetchone() == (0,)


def test_deleting_an_analysis_removes_result_and_retry_key(database_url):
    persistence = store(database_url)

    with persistence.transaction() as repository:
        repository.put_resource("analysis", {"id": "a1"}, "alice")
        repository.put_analysis_result("a1", {"manifest": {}})
        repository.remember("analyses:alice", "key", "d", "a1")

    with persistence.transaction() as repository:
        repository.delete_resource("analysis", "a1")

    with persistence.read() as repository:
        assert repository.owner("analysis", "a1") is None
        assert repository.replay("analyses:alice", "key", "other") is None

        with pytest.raises(WorkspaceError):
            repository.analysis_result("a1")


def test_changes_are_queued_transactionally_and_claimed_in_order(database_url):
    persistence = store(database_url)

    with pytest.raises(RuntimeError):
        with persistence.transaction() as repository:
            repository.record_change("schema", "lost")
            raise RuntimeError("interrupted")

    with persistence.transaction() as repository:
        repository.record_change("schema", "s1")
        repository.record_change("analysis", "a1", deleted=True)

    with persistence.transaction() as repository:
        claimed = repository.claim_changes(10)

        assert [change for _, change in claimed] == [
            ResourceChange("schema", "s1"),
            ResourceChange("analysis", "a1", True),
        ]
        assert len(repository.claim_changes(1)) == 1
        repository.delete_changes([claimed[0][0]])

    with persistence.transaction() as repository:
        assert [change for _, change in repository.claim_changes(10)] == [
            ResourceChange("analysis", "a1", True)
        ]


def test_concurrent_dispatchers_skip_locked_changes(database_url):
    persistence = store(database_url)

    with persistence.transaction() as repository:
        repository.record_change("schema", "s1")

    with persistence.transaction() as first:
        assert len(first.claim_changes(10)) == 1

        with persistence.transaction() as second:
            assert second.claim_changes(10) == []
