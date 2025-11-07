import time
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from typing import Any
from uuid import uuid4

import httpx


def get_json(client: httpx.Client, path: str) -> Any:
    """Read a public resource and retain the response body on HTTP failures."""
    response = client.get(path)
    assert response.status_code == 200, response.text

    return response.json()


def analyze(
    client: httpx.Client,
    content: str = '{"price":12,"name":"book"}',
    document_format: str = "json",
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Submit a source document and follow its analysis until completion."""
    response = client.post(
        "/api/v2/analyses",
        headers={"Idempotency-Key": uuid4().hex},
        json={
            "title": "Products",
            "documents": [
                {
                    "name": f"sample.{document_format}",
                    "format": document_format,
                    "size": len(content.encode()),
                    "content": content,
                }
            ],
        },
    )
    assert response.status_code == 202, response.text
    location = response.headers["location"]
    assert location == f"/api/v2/analyses/{response.json()['id']}"
    deadline = time.monotonic() + 60
    resource = response.json()

    while time.monotonic() < deadline:
        resource = get_json(client, location)

        if resource["status"] in ("completed", "failed"):
            break

        time.sleep(0.1)

    assert resource["status"] == "completed", resource
    manifest = get_json(client, resource["_links"]["manifest"]["href"])

    return resource, manifest


def draft_body(resource: dict[str, Any], manifest: dict[str, Any]) -> dict[str, Any]:
    """Select the analysis suggestion through the public draft contract."""
    return {
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


def create_draft(
    client: httpx.Client, resource: dict[str, Any], manifest: dict[str, Any]
) -> dict[str, Any]:
    """Create an independent draft with a fresh idempotency key."""
    response = client.post(
        "/api/v2/schemas",
        json=draft_body(resource, manifest),
        headers={"Idempotency-Key": uuid4().hex},
    )
    assert response.status_code == 201, response.text
    schema = response.json()
    assert response.headers["etag"] == f'"{schema["snapshot"]["id"]}:s1"'
    assert response.headers["location"] == schema["_links"]["resource"]["href"]

    return schema


def editable_member(
    client: httpx.Client, manifest: dict[str, Any]
) -> tuple[str, dict[str, Any]]:
    """Read the first object property or XML attribute using response links."""
    node = get_json(client, manifest["_links"]["root"]["href"])

    if node["kind"] == "xmlElement":
        node = get_json(client, node["_links"]["contentNodeId"]["href"])

    field = "attributes" if node["kind"] == "xmlComplex" else "properties"
    collection = node["_links"][field]["href"]
    page = get_json(client, collection)

    return collection, page["items"][0]["member"]


def rename_changeset(member: dict[str, Any], name: str) -> dict[str, Any]:
    """Describe one rename against the initial draft revision."""
    operation = {"kind": "renameProperty", "memberId": member["id"], "name": name}

    if isinstance(member["name"], dict):
        operation = {
            "kind": "renameXmlName",
            "target": {"kind": "member", "id": member["id"]},
            "name": {"namespaceUri": None, "localName": name},
        }

    return {
        "clientMutationId": uuid4().hex,
        "baseRevision": "s1",
        "operations": [operation],
    }


def parallel_posts(
    client: httpx.Client,
    path: str,
    bodies: list[dict[str, Any]],
    headers: dict[str, str],
) -> list[httpx.Response]:
    """Release simultaneous HTTP writes from independent worker threads."""
    ready = Barrier(len(bodies))

    def post(body: dict[str, Any]) -> httpx.Response:
        ready.wait(timeout=10)

        return client.post(path, json=body, headers=headers)

    with ThreadPoolExecutor(max_workers=len(bodies)) as executor:
        return list(executor.map(post, bodies))
