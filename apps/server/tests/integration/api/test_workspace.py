import base64
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier

from fastapi.testclient import TestClient

from env.config import Settings
from main import create_app


def settings(directory: Path, database_url: str) -> Settings:
    return Settings(
        environment="production",
        host="127.0.0.1",
        port=8000,
        upload_root=directory / "uploads",
        wordnet_root=Path("nltk_data"),
        cleanup_delay=300,
        allowed_origins=("http://localhost:3000",),
        database_url=database_url,
    )


def analyze(
    client: TestClient,
    content: str = '{"price":12,"name":"book"}',
    format: str = "json",
):
    body = {
        "title": "Products",
        "documents": [
            {
                "name": f"sample.{format}",
                "format": format,
                "size": len(content.encode()),
                "content": content,
            }
        ],
    }
    response = client.post(
        "/api/v2/analyses", json=body, headers={"Idempotency-Key": "analysis-1"}
    )
    assert response.status_code == 202, response.text
    assert all("content" not in document for document in response.json()["documents"])
    assert response.headers["location"] == f"/api/v2/analyses/{response.json()['id']}"
    resource = response.json()

    deadline = time.monotonic() + 30

    while time.monotonic() < deadline:
        resource = client.get(response.headers["location"]).json()

        if resource["status"] in ("completed", "failed"):
            break

        time.sleep(0.01)

    assert resource["status"] == "completed", resource
    assert resource["documents"]
    assert all("content" not in document for document in resource["documents"])
    manifest = client.get(
        f"/api/v2/analyses/{resource['id']}/revisions/{resource['revision']}/manifest"
    ).json()

    return resource, manifest, body


def draft(client: TestClient, resource, manifest, key="draft-1"):
    body = {
        "title": "Products draft",
        "source": {
            "kind": "analysis",
            "analysisId": resource["id"],
            "revision": resource["revision"],
            "seedId": manifest["suggestedDraft"]["seedId"],
            "rootAlternativeId": manifest["suggestedDraft"][
                "suggestedRootAlternativeId"
            ],
        },
    }
    response = client.post(
        "/api/v2/schemas", json=body, headers={"Idempotency-Key": key}
    )
    assert response.status_code == 201, response.text

    return response.json(), body


def root_rows(client, manifest, limit=50):
    snapshot = manifest["snapshot"]
    path = f"/api/v2/schemas/{snapshot['id']}/revisions/{snapshot['revision']}"
    node = client.get(f"{path}/nodes/{manifest['rootNodeId']}").json()
    response = client.get(
        f"{path}/collections/{node['properties']['id']}/items", params={"limit": limit}
    )
    assert response.status_code == 200, response.text

    return path, node, response.json()


def test_analysis_draft_save_and_restart(tmp_path, database_url):
    configuration = settings(tmp_path, database_url)

    with TestClient(create_app(settings=configuration)) as client:
        resource, manifest, _ = analyze(client)
        schema, _ = draft(client, resource, manifest)
        path, _, page = root_rows(client, schema)
        member_id = page["items"][0]["member"]["id"]
        schema_id = schema["snapshot"]["id"]
        changes = {
            "clientMutationId": "rename-1",
            "baseRevision": "s1",
            "operations": [
                {"kind": "renameProperty", "memberId": member_id, "name": "cost"}
            ],
        }
        response = client.post(
            f"/api/v2/schemas/{schema_id}/changesets",
            json=changes,
            headers={"If-Match": f'"{schema_id}:s1"'},
        )
        assert response.status_code == 201, response.text
        receipt = response.json()
        assert receipt["result"]["revision"] == "s2"
        assert (
            client.get(f"{path}/collections/{page['collectionId']}/items").json()[
                "items"
            ][0]["member"]["name"]
            == "price"
        )
        assert client.get(f"/api/v2/schemas/{schema_id}").json()["revision"] == "s2"

    with TestClient(create_app(settings=configuration)) as restarted:
        reopened = restarted.get(receipt["result"]["manifestUrl"]).json()
        _, _, rows = root_rows(restarted, reopened)
        assert rows["items"][0]["member"]["name"] == "cost"
        assert (
            restarted.get(f"/api/v2/schemas/{schema_id}/changesets/rename-1").json()
            == receipt
        )
        assert restarted.get("/api/v2/schemas").json()[0]["document_count"] == 1


def test_idempotent_creation_and_independent_drafts(tmp_path, database_url):
    with TestClient(create_app(settings=settings(tmp_path, database_url))) as client:
        resource, manifest, body = analyze(client)
        replay = client.post(
            "/api/v2/analyses", json=body, headers={"Idempotency-Key": "analysis-1"}
        )
        assert replay.json()["id"] == resource["id"]
        conflict = client.post(
            "/api/v2/analyses",
            json={**body, "title": "Changed"},
            headers={"Idempotency-Key": "analysis-1"},
        )
        assert conflict.status_code == 409
        assert conflict.json()["code"] == "idempotency_conflict"
        first, draft_body = draft(client, resource, manifest)
        repeated, _ = draft(client, resource, manifest)
        other, _ = draft(client, resource, manifest, "another-draft")
        assert first == repeated
        assert first["snapshot"]["id"] != other["snapshot"]["id"]
        conflict = client.post(
            "/api/v2/schemas",
            json={**draft_body, "title": "Changed"},
            headers={"Idempotency-Key": "draft-1"},
        )
        assert conflict.status_code == 409
        assert len(client.get("/api/v2/schemas").json()) == 2


def test_atomic_changeset_replay_preconditions_and_pagination(tmp_path, database_url):
    with TestClient(create_app(settings=settings(tmp_path, database_url))) as client:
        resource, manifest, _ = analyze(client)
        schema, _ = draft(client, resource, manifest)
        path, node, page = root_rows(client, schema, 1)
        schema_id = schema["snapshot"]["id"]
        endpoint = f"/api/v2/schemas/{schema_id}/changesets"
        member_id = page["items"][0]["member"]["id"]
        collection = f"{path}/collections/{node['properties']['id']}/items"
        second = client.get(
            collection, params={"limit": 1, "cursor": page["nextCursor"]}
        ).json()
        assert second["items"][0]["member"]["name"] == "name"
        assert second["nextCursor"] is None
        assert (
            client.get(
                collection, params={"limit": 2, "cursor": page["nextCursor"]}
            ).status_code
            == 400
        )
        malformed = base64.urlsafe_b64encode(b"[" * 1100).decode()
        assert client.get(collection, params={"cursor": malformed}).status_code == 400

        changes = {
            "clientMutationId": "mutation",
            "baseRevision": "s1",
            "operations": [
                {"kind": "renameProperty", "memberId": member_id, "name": "cost"}
            ],
        }
        headers = {"If-Match": f'"{schema_id}:s1"'}
        assert client.post(endpoint, json=changes).status_code == 428
        invalid = {
            **changes,
            "operations": [
                *changes["operations"],
                {
                    "kind": "moveMember",
                    "memberId": "absent",
                    "targetCollectionId": page["collectionId"],
                    "beforeMemberId": None,
                },
            ],
        }
        assert client.post(endpoint, json=invalid, headers=headers).status_code == 422
        assert client.get(f"/api/v2/schemas/{schema_id}").json()["revision"] == "s1"
        assert client.get(collection).json()["items"][0]["member"]["name"] == "price"
        accepted = client.post(endpoint, json=changes, headers=headers)
        assert accepted.status_code == 201
        assert (
            client.post(endpoint, json=changes, headers=headers).json()
            == accepted.json()
        )
        assert client.post(endpoint, json=invalid, headers=headers).status_code == 409
        assert (
            client.post(
                endpoint, json={**changes, "clientMutationId": "other"}, headers=headers
            ).status_code
            == 412
        )
        new_collection = collection.replace("/s1/", "/s2/")
        assert (
            client.get(
                new_collection, params={"limit": 1, "cursor": page["nextCursor"]}
            ).status_code
            == 400
        )
        assert client.get(new_collection).json()["items"][0]["member"]["name"] == "cost"


def test_move_updates_both_owners_and_rejects_cycles(tmp_path, database_url):
    with TestClient(create_app(settings=settings(tmp_path, database_url))) as client:
        resource, manifest, _ = analyze(client, '{"left":{"a":1},"right":{}}')
        schema, _ = draft(client, resource, manifest)
        path, node, page = root_rows(client, schema)
        schema_id = schema["snapshot"]["id"]
        left, right = [row["member"] for row in page["items"]]
        left_node = client.get(f"{path}/nodes/{left['valueNodeId']}").json()
        right_node = client.get(f"{path}/nodes/{right['valueNodeId']}").json()
        left_collection = left_node["properties"]["id"]
        right_collection = right_node["properties"]["id"]
        nested = client.get(f"{path}/collections/{left_collection}/items").json()[
            "items"
        ][0]["member"]
        endpoint = f"/api/v2/schemas/{schema_id}/changesets"
        headers = {"If-Match": f'"{schema_id}:s1"'}
        cyclic = {
            "clientMutationId": "cycle",
            "baseRevision": "s1",
            "operations": [
                {
                    "kind": "moveMember",
                    "memberId": left["id"],
                    "targetCollectionId": left_collection,
                    "beforeMemberId": None,
                }
            ],
        }
        assert client.post(endpoint, json=cyclic, headers=headers).status_code == 422
        moved = {
            "clientMutationId": "move",
            "baseRevision": "s1",
            "operations": [
                {
                    "kind": "moveMember",
                    "memberId": nested["id"],
                    "targetCollectionId": right_collection,
                    "beforeMemberId": None,
                }
            ],
        }
        assert client.post(endpoint, json=moved, headers=headers).status_code == 201
        new_path = path.replace("/s1", "/s2")
        assert (
            client.get(f"{new_path}/nodes/{left['valueNodeId']}").json()["properties"][
                "totalItems"
            ]
            == 0
        )
        assert (
            client.get(f"{new_path}/nodes/{right['valueNodeId']}").json()["properties"][
                "totalItems"
            ]
            == 1
        )
        assert (
            client.get(f"{new_path}/collections/{right_collection}/items").json()[
                "items"
            ][0]["member"]["id"]
            == nested["id"]
        )


def test_concurrent_changesets_preserve_one_winner_and_immutable_base(
    tmp_path, database_url
):
    with TestClient(create_app(settings=settings(tmp_path, database_url))) as client:
        resource, analysis, _ = analyze(client)
        schema, _ = draft(client, resource, analysis)
        path, _, page = root_rows(client, schema)
        schema_id = schema["snapshot"]["id"]
        endpoint = f"/api/v2/schemas/{schema_id}/changesets"
        headers = {"If-Match": f'"{schema_id}:s1"'}
        ready = Barrier(4)

        def rename(index):
            ready.wait(timeout=10)

            return client.post(
                endpoint,
                headers=headers,
                json={
                    "clientMutationId": f"rename-{index}",
                    "baseRevision": "s1",
                    "operations": [
                        {
                            "kind": "renameProperty",
                            "memberId": page["items"][0]["member"]["id"],
                            "name": f"cost_{index}",
                        }
                    ],
                },
            )

        with ThreadPoolExecutor(max_workers=4) as executor:
            responses = list(executor.map(rename, range(4)))

        assert sorted(response.status_code for response in responses) == [
            201,
            412,
            412,
            412,
        ]
        winner = next(
            index for index, reply in enumerate(responses) if reply.status_code == 201
        )
        collection = f"{path}/collections/{page['collectionId']}/items"
        assert client.get(collection).json()["items"][0]["member"]["name"] == "price"
        assert (
            client.get(collection.replace("/s1/", "/s2/")).json()["items"][0]["member"][
                "name"
            ]
            == f"cost_{winner}"
        )
        assert client.get(f"/api/v2/schemas/{schema_id}").json()["revision"] == "s2"


def test_concurrent_changeset_retries_share_one_durable_receipt(tmp_path, database_url):
    with TestClient(create_app(settings=settings(tmp_path, database_url))) as client:
        resource, analysis, _ = analyze(client)
        schema, _ = draft(client, resource, analysis)
        _, _, page = root_rows(client, schema)
        schema_id = schema["snapshot"]["id"]
        endpoint = f"/api/v2/schemas/{schema_id}/changesets"
        ready = Barrier(4)
        body = {
            "clientMutationId": "same-request",
            "baseRevision": "s1",
            "operations": [
                {
                    "kind": "renameProperty",
                    "memberId": page["items"][0]["member"]["id"],
                    "name": "cost",
                }
            ],
        }

        def save():
            ready.wait(timeout=10)

            return client.post(
                endpoint, json=body, headers={"If-Match": f'"{schema_id}:s1"'}
            )

        with ThreadPoolExecutor(max_workers=4) as executor:
            futures = [executor.submit(save) for _ in range(4)]
            responses = [future.result(timeout=15) for future in futures]

        assert [response.status_code for response in responses] == [201] * 4
        assert all(response.json() == responses[0].json() for response in responses)
        assert client.get(f"/api/v2/schemas/{schema_id}").json()["revision"] == "s2"
        assert client.get(f"{endpoint}/same-request").json() == responses[0].json()
