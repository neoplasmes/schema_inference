from typing import cast

from fastapi import FastAPI
from fastapi.testclient import TestClient
from psycopg import connect, sql

from api.http.principal import current_principal
from app.ports.tools.cache_invalidation import CacheInvalidationError
from app.use_cases.dispatch_changes import DispatchChanges
from core.entities import Principal, ResourceChange
from env.uow.workspace import PostgresWorkspaceUow
from main import create_app

from .test_workspace import analyze, draft, settings, trusted

ALICE = Principal("alice", frozenset({"editor"}))
BOB = Principal("bob", frozenset({"editor"}))
ADMIN = Principal("root", frozenset({"admin"}))


class RecordingInvalidation:
    def __init__(self):
        self.changes: list[ResourceChange] = []
        self.failing = False

    def invalidate(self, changes):
        if self.failing:
            raise CacheInvalidationError("down")

        self.changes.extend(changes)


def act_as(client: TestClient, principal: Principal) -> None:
    cast(FastAPI, client.app).dependency_overrides[current_principal] = (
        lambda: principal
    )


def test_resources_are_visible_only_to_their_owner(tmp_path, database_url):
    with TestClient(create_app(settings=settings(tmp_path, database_url))) as client:
        act_as(client, ALICE)
        resource, manifest, _ = analyze(client)
        schema, _ = draft(client, resource, manifest)
        schema_id = schema["snapshot"]["id"]
        analysis_path = f"/api/v2/analyses/{resource['id']}"
        assert [item["id"] for item in client.get("/api/v2/analyses").json()] == [
            resource["id"]
        ]

        act_as(client, BOB)
        assert client.get("/api/v2/analyses").json() == []
        assert client.get("/api/v2/schemas").json() == []

        for path in (
            analysis_path,
            f"{analysis_path}/revisions/a1/manifest",
            f"/api/v2/schemas/{schema_id}",
            f"/api/v2/schemas/{schema_id}/revisions/s1/manifest",
            f"/api/v2/schemas/{schema_id}/changesets/none",
        ):
            assert client.get(path).status_code == 404, path

        assert client.delete(analysis_path).status_code == 404
        assert client.delete(f"/api/v2/schemas/{schema_id}").status_code == 404
        stolen = client.post(
            "/api/v2/schemas",
            json={
                "title": "Stolen",
                "source": {
                    "kind": "analysis",
                    "analysisId": resource["id"],
                    "revision": resource["revision"],
                    "seedId": manifest["suggestedDraft"]["seedId"],
                    "rootAlternativeId": manifest["suggestedDraft"][
                        "suggestedRootAlternativeId"
                    ],
                },
            },
            headers={"Idempotency-Key": "stolen"},
        )
        assert stolen.status_code == 404

        act_as(client, ADMIN)
        assert len(client.get("/api/v2/analyses").json()) == 1
        assert client.get(f"/api/v2/schemas/{schema_id}").status_code == 200


def test_deleting_schema_and_analysis_cascades_and_records_changes(
    tmp_path, database_url
):
    invalidation = RecordingInvalidation()
    application = create_app(
        settings=settings(tmp_path, database_url), cache_invalidation=invalidation
    )

    with trusted(application) as client:
        resource, manifest, _ = analyze(client)
        schema, _ = draft(client, resource, manifest)
        schema_id = schema["snapshot"]["id"]
        path = f"/api/v2/schemas/{schema_id}"
        assert client.delete(path).status_code == 428
        assert client.delete(path, headers={"If-Match": '"x:s9"'}).status_code == 412
        deleted = client.delete(path, headers={"If-Match": f'"{schema_id}:s1"'})
        assert deleted.status_code == 204
        assert deleted.content == b""
        assert client.get(path).status_code == 404
        assert client.get(f"{path}/revisions/s1/manifest").status_code == 404
        assert client.get("/api/v2/schemas").json() == []

        analysis_path = f"/api/v2/analyses/{resource['id']}"
        assert client.delete(analysis_path).status_code == 204
        assert client.get(analysis_path).status_code == 404
        assert client.delete(analysis_path).status_code == 404

    with connect(database_url, prepare_threshold=None) as connection:
        for table in (
            "resources",
            "analysis_results",
            "revisions",
            "nodes",
            "collections",
            "members",
            "changesets",
            "idempotency",
        ):
            count = connection.execute(
                sql.SQL("SELECT count(*) FROM {}").format(sql.Identifier(table))
            ).fetchone()
            assert count == (0,), table

    assert ResourceChange("schema", schema_id, True) in invalidation.changes
    assert ResourceChange("analysis", resource["id"], True) in invalidation.changes
    assert ResourceChange("schema", schema_id) in invalidation.changes


def test_changes_survive_a_failing_cache_until_it_recovers(tmp_path, database_url):
    invalidation = RecordingInvalidation()
    invalidation.failing = True
    application = create_app(
        settings=settings(tmp_path, database_url), cache_invalidation=invalidation
    )

    with trusted(application) as client:
        analyze(client)

    store = PostgresWorkspaceUow(database_url)

    with store.read() as repository:
        queued = repository.pending_analyses()

    assert queued == []
    assert invalidation.changes == []

    invalidation.failing = False

    assert DispatchChanges(store, invalidation).execute() > 0
    assert DispatchChanges(store, invalidation).execute() == 0
    assert {change.kind for change in invalidation.changes} == {"analysis"}
