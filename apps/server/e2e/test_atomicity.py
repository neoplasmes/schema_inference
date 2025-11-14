from flows import (
    analyze,
    create_draft,
    editable_member,
    get_json,
    rename_changeset,
)


def test_failed_batch_rolls_back_and_retry_preconditions_are_enforced(api):
    resource, analysis = analyze(api)
    schema = create_draft(api, resource, analysis)
    collection, member = editable_member(api, schema)
    original_page = get_json(api, collection)
    changes = rename_changeset(member, "cost")
    endpoint = schema["_links"]["changesets"]["href"]
    schema_id = schema["snapshot"]["id"]
    headers = {"If-Match": f'"{schema_id}:s1"'}
    missing_precondition = api.post(endpoint, json=changes)
    assert missing_precondition.status_code == 428, missing_precondition.text
    assert missing_precondition.json()["code"] == "precondition_required"
    invalid = {
        **changes,
        "operations": [
            *changes["operations"],
            {
                "kind": "moveMember",
                "memberId": "absent",
                "targetCollectionId": original_page["collectionId"],
                "beforeMemberId": None,
            },
        ],
    }
    rejected = api.post(endpoint, json=invalid, headers=headers)
    assert rejected.status_code == 422, rejected.text
    assert get_json(api, schema["_links"]["resource"]["href"])["revision"] == "s1"
    assert get_json(api, collection) == original_page
    assert api.get(f"{endpoint}/{changes['clientMutationId']}").status_code == 404

    accepted = api.post(endpoint, json=changes, headers=headers)
    assert accepted.status_code == 201, accepted.text
    replay = api.post(endpoint, json=changes, headers=headers)
    assert replay.status_code == 201, replay.text
    assert replay.json() == accepted.json()
    conflict = api.post(endpoint, json=invalid, headers=headers)
    assert conflict.status_code == 409, conflict.text
    assert conflict.json()["code"] == "idempotency_conflict"
    latest = get_json(api, schema["_links"]["resource"]["href"])
    assert latest["revision"] == "s2"
    _, renamed = editable_member(
        api, get_json(api, latest["_links"]["manifest"]["href"])
    )
    assert renamed["name"] == "cost"
    assert get_json(api, collection) == original_page
