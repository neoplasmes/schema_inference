from flows import analyze, create_draft, editable_member, get_json, rename_changeset


def test_analyses_are_listed_and_deleted_with_their_results(api):
    resource, manifest = analyze(api)
    listed = get_json(api, "/api/v2/analyses")
    assert resource["id"] in [item["id"] for item in listed]
    item = next(item for item in listed if item["id"] == resource["id"])
    assert item["_links"]["self"]["href"] == f"/api/v2/analyses/{resource['id']}"
    assert all("content" not in document for document in item["documents"])
    schema = create_draft(api, resource, manifest)

    deleted = api.delete(resource["_links"]["self"]["href"])
    assert deleted.status_code == 204
    assert deleted.content == b""
    assert api.get(resource["_links"]["self"]["href"]).status_code == 404
    assert api.get(resource["_links"]["manifest"]["href"]).status_code == 404
    assert resource["id"] not in [
        item["id"] for item in get_json(api, "/api/v2/analyses")
    ]
    assert api.delete(resource["_links"]["self"]["href"]).status_code == 404
    assert api.get(schema["_links"]["resource"]["href"]).status_code == 200


def test_schema_deletion_requires_the_current_etag_and_cascades(api):
    resource, manifest = analyze(api)
    schema = create_draft(api, resource, manifest)
    schema_id = schema["snapshot"]["id"]
    path = schema["_links"]["resource"]["href"]
    collection, member = editable_member(api, schema)
    changes = api.post(
        schema["_links"]["changesets"]["href"],
        json=rename_changeset(member, "cost"),
        headers={"If-Match": f'"{schema_id}:s1"'},
    )
    assert changes.status_code == 201, changes.text

    missing = api.delete(path)
    assert missing.status_code == 428
    assert missing.json()["code"] == "precondition_required"
    stale = api.delete(path, headers={"If-Match": f'"{schema_id}:s1"'})
    assert stale.status_code == 412
    assert stale.json()["code"] == "revision_conflict"
    assert api.get(path).status_code == 200

    deleted = api.delete(path, headers={"If-Match": f'"{schema_id}:s2"'})
    assert deleted.status_code == 204
    assert api.get(path).status_code == 404
    assert api.get(schema["_links"]["self"]["href"]).status_code == 404
    assert api.get(changes.headers["location"]).status_code == 404
    assert api.get(collection).status_code == 404
    assert schema_id not in [item["id"] for item in get_json(api, "/api/v2/schemas")]
    assert (
        api.delete(path, headers={"If-Match": f'"{schema_id}:s2"'}).status_code == 404
    )
    assert api.get(resource["_links"]["self"]["href"]).status_code == 200


def test_surrogate_keys_are_comma_separated(api):
    resource, manifest = analyze(api)
    schema = create_draft(api, resource, manifest)
    schema_id = schema["snapshot"]["id"]

    response = api.get(f"/api/v2/schemas/{schema_id}/revisions/s1/manifest")

    assert response.headers["surrogate-key"] == f"schema:{schema_id}"
    assert api.get("/api/v2/schemas").headers["surrogate-key"] == "schemas"
    assert api.get("/api/v2/analyses").headers["surrogate-key"] == "analyses"
