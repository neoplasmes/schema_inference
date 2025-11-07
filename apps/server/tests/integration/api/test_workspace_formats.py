import time

import pytest
from fastapi.testclient import TestClient

from env.uow.workspace import PostgresWorkspaceUow
from main import create_app

from .test_workspace import analyze, draft, root_rows, settings


@pytest.mark.parametrize(
    "content,format", [("[]", "json"), ("{}", "json"), ("[]", "yaml"), ("{}", "yaml")]
)
def test_empty_container_is_not_a_null_scalar(tmp_path, database_url, content, format):
    with TestClient(create_app(settings=settings(tmp_path, database_url))) as client:
        resource, analysis, _ = analyze(client, content, format)
        schema, _ = draft(client, resource, analysis)
        snapshot = schema["snapshot"]
        path = f"/api/v2/schemas/{snapshot['id']}/revisions/s1"
        root = client.get(f"{path}/nodes/{schema['rootNodeId']}").json()
        assert root["kind"] == ("array" if content == "[]" else "object")

        if content == "{}":
            page = client.get(
                f"{path}/collections/{root['properties']['id']}/items"
            ).json()
            assert page["items"] == []
            assert page["totalItems"] == 0
            assert page["nextCursor"] is None


def test_yaml_single_mapping_keeps_the_document_root(tmp_path, database_url):
    with TestClient(create_app(settings=settings(tmp_path, database_url))) as client:
        resource, analysis, _ = analyze(client, "product:\n  price: 12\n", "yaml")
        schema, _ = draft(client, resource, analysis)
        _, root, page = root_rows(client, schema)
        assert root["kind"] == "object"
        assert page["items"][0]["member"]["name"] == "product"
        assert page["items"][0]["valueSummary"]["kind"] == "object"


def test_xml_namespaces_attributes_and_typed_simple_content_survive_rename(
    tmp_path, database_url
):
    with TestClient(create_app(settings=settings(tmp_path, database_url))) as client:
        resource, analysis, _ = analyze(
            client, '<p:price xmlns:p="urn:shop" currency="USD">12.5</p:price>', "xml"
        )
        schema, _ = draft(client, resource, analysis)
        schema_id = schema["snapshot"]["id"]
        path = f"/api/v2/schemas/{schema_id}/revisions/s1"
        root = client.get(f"{path}/nodes/{schema['rootNodeId']}").json()
        assert root["name"] == {"namespaceUri": "urn:shop", "localName": "price"}
        complex_node = client.get(f"{path}/nodes/{root['contentNodeId']}").json()
        simple = client.get(
            f"{path}/nodes/{complex_node['simpleContentNodeId']}"
        ).json()
        assert simple["scalarType"] == "decimal"
        assert complex_node["particleNodeId"] is None
        page = client.get(
            f"{path}/collections/{complex_node['attributes']['id']}/items"
        ).json()
        attribute = page["items"][0]["member"]
        assert attribute["name"] == {"namespaceUri": None, "localName": "currency"}
        body = {
            "clientMutationId": "xml-name",
            "baseRevision": "s1",
            "operations": [
                {
                    "kind": "renameXmlName",
                    "target": {"kind": "member", "id": attribute["id"]},
                    "name": {"namespaceUri": None, "localName": "unit"},
                }
            ],
        }
        response = client.post(
            f"/api/v2/schemas/{schema_id}/changesets",
            json=body,
            headers={"If-Match": f'"{schema_id}:s1"'},
        )
        assert response.status_code == 201
        page = client.get(
            f"/api/v2/schemas/{schema_id}/revisions/s2/collections/{complex_node['attributes']['id']}/items"
        ).json()
        assert page["items"][0]["member"]["name"]["localName"] == "unit"


@pytest.mark.parametrize(
    "content,format",
    [
        ('{"x":1,"x":2}', "json"),
        ("[NaN]", "json"),
        ("[1e999]", "json"),
        ("<unclosed>", "xml"),
        ("x: &self [*self]", "yaml"),
    ],
)
def test_malformed_documents_have_durable_failed_status(
    tmp_path, database_url, content, format
):
    configuration = settings(tmp_path, database_url)

    with TestClient(create_app(settings=configuration)) as client:
        response = client.post(
            "/api/v2/analyses",
            json={
                "title": "Invalid",
                "documents": [
                    {
                        "name": f"input.{format}",
                        "format": format,
                        "size": len(content.encode()),
                        "content": content,
                    }
                ],
            },
            headers={"Idempotency-Key": "invalid"},
        )
        assert response.status_code == 202
        location = response.headers["location"]

        deadline = time.monotonic() + 30

        while time.monotonic() < deadline:
            resource = client.get(location).json()

            if resource["status"] == "failed":
                break

            time.sleep(0.01)

        assert resource["status"] == "failed"
        assert resource["error"]
        assert client.get(f"{location}/revisions/a1/manifest").status_code == 409

    with TestClient(create_app(settings=configuration)) as restarted:
        assert restarted.get(location).json()["status"] == "failed"


@pytest.mark.parametrize("status", ["queued", "processing"])
def test_restart_resumes_unfinished_analysis(tmp_path, database_url, status):
    configuration = settings(tmp_path, database_url)
    store = PostgresWorkspaceUow(database_url)
    store.initialize()
    content = '{"price":12}'

    with store.transaction() as repository:
        repository.put_resource(
            "analysis",
            {
                "id": "interrupted",
                "title": "Interrupted",
                "revision": "a1",
                "created_at": "2025-10-20T12:00:00Z",
                "status": status,
                "progress": 10,
                "error": None,
                "documents": [
                    {
                        "id": "document-1",
                        "name": "price.json",
                        "format": "json",
                        "size": len(content),
                        "content": content,
                    }
                ],
            },
        )

    with TestClient(create_app(settings=configuration)) as client:
        deadline = time.monotonic() + 30

        while time.monotonic() < deadline:
            resource = client.get("/api/v2/analyses/interrupted").json()

            if resource["status"] == "completed":
                break

            time.sleep(0.01)

        assert resource["status"] == "completed"
        assert (
            client.get("/api/v2/analyses/interrupted/revisions/a1/manifest").json()[
                "statistics"
            ]["documents"]
            == 1
        )


@pytest.mark.parametrize(
    "content,format,count",
    [
        ('<root><item code="x"><name>book</name></item></root>', "xml", 2),
        ('{"items":[{"name":"book"}]}', "json", 1),
    ],
)
def test_nested_xml_and_array_summaries_expose_members_behind_wrappers(
    tmp_path, database_url, content, format, count
):
    with TestClient(create_app(settings=settings(tmp_path, database_url))) as client:
        resource, analysis, _ = analyze(client, content, format)
        schema, _ = draft(client, resource, analysis)
        schema_id = schema["snapshot"]["id"]
        path = f"/api/v2/schemas/{schema_id}/revisions/s1"
        node = client.get(f"{path}/nodes/{schema['rootNodeId']}").json()

        while node["kind"] in ("xmlElement", "xmlComplex"):
            next_id = node.get("contentNodeId") or node.get("particleNodeId")
            node = client.get(f"{path}/nodes/{next_id}").json()

        collection_id = (node.get("particles") or node["properties"])["id"]
        page = client.get(f"{path}/collections/{collection_id}/items").json()
        assert page["items"][0]["valueSummary"]["directMemberCount"] == count


def test_deep_array_summary_reaches_the_observed_object(tmp_path, database_url):
    content = '{"name":"book"}'

    for _ in range(12):
        content = f"[{content}]"

    with TestClient(create_app(settings=settings(tmp_path, database_url))) as client:
        resource, analysis, _ = analyze(client, '{"items":' + content + "}")
        schema, _ = draft(client, resource, analysis)
        _, _, page = root_rows(client, schema)
        assert page["items"][0]["valueSummary"]["directMemberCount"] == 1
