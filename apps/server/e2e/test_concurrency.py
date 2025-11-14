from uuid import uuid4

from flows import (
    analyze,
    create_draft,
    draft_body,
    editable_member,
    get_json,
    parallel_posts,
    rename_changeset,
)


def test_simultaneous_draft_retries_create_one_schema(api):
    resource, analysis = analyze(api)
    body = draft_body(resource, analysis)
    headers = {"Idempotency-Key": uuid4().hex}
    previous = {item["id"] for item in get_json(api, "/api/v2/schemas")}
    responses = parallel_posts(api, "/api/v2/schemas", [body] * 4, headers)
    assert [reply.status_code for reply in responses] == [201] * 4, [
        reply.text for reply in responses
    ]
    schema = responses[0].json()
    assert all(reply.json() == schema for reply in responses)
    created = {item["id"] for item in get_json(api, "/api/v2/schemas")} - previous
    assert created == {schema["snapshot"]["id"]}
    conflict = api.post(
        "/api/v2/schemas", json={**body, "title": "Different draft"}, headers=headers
    )
    assert conflict.status_code == 409, conflict.text
    assert conflict.json()["code"] == "idempotency_conflict"


def test_simultaneous_changesets_have_one_winner_and_preserve_the_old_revision(api):
    resource, analysis = analyze(api)
    schema = create_draft(api, resource, analysis)
    collection, member = editable_member(api, schema)
    original_page = get_json(api, collection)
    schema_id = schema["snapshot"]["id"]
    bodies = [rename_changeset(member, f"cost_{index}") for index in range(4)]
    responses = parallel_posts(
        api,
        schema["_links"]["changesets"]["href"],
        bodies,
        {"If-Match": f'"{schema_id}:s1"'},
    )
    assert sorted(reply.status_code for reply in responses) == [201, 412, 412, 412], [
        reply.text for reply in responses
    ]
    winner = next(
        index for index, reply in enumerate(responses) if reply.status_code == 201
    )
    latest = get_json(api, schema["_links"]["resource"]["href"])
    assert latest["revision"] == "s2"
    latest_manifest = get_json(api, latest["_links"]["manifest"]["href"])
    _, updated_member = editable_member(api, latest_manifest)
    assert updated_member["name"] == f"cost_{winner}"
    assert get_json(api, collection) == original_page
    assert (
        get_json(api, responses[winner].headers["location"]) == responses[winner].json()
    )

    for index, reply in enumerate(responses):
        if reply.status_code == 412:
            receipt_path = (
                schema["_links"]["changesets"]["href"]
                + "/"
                + bodies[index]["clientMutationId"]
            )
            assert api.get(receipt_path).status_code == 404


def test_simultaneous_changeset_retries_share_one_receipt(api):
    resource, analysis = analyze(api)
    schema = create_draft(api, resource, analysis)
    _, member = editable_member(api, schema)
    changes = rename_changeset(member, "cost")
    schema_id = schema["snapshot"]["id"]
    responses = parallel_posts(
        api,
        schema["_links"]["changesets"]["href"],
        [changes] * 4,
        {"If-Match": f'"{schema_id}:s1"'},
    )
    assert [reply.status_code for reply in responses] == [201] * 4, [
        reply.text for reply in responses
    ]
    receipt = responses[0].json()
    assert all(reply.json() == receipt for reply in responses)
    assert get_json(api, responses[0].headers["location"]) == receipt
    assert get_json(api, schema["_links"]["resource"]["href"])["revision"] == "s2"
