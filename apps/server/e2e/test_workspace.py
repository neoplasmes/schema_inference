import httpx
import pytest
from flows import (
    analyze,
    create_draft,
    editable_member,
    get_json,
    rename_changeset,
    restart_server,
)


@pytest.mark.parametrize(
    "document_format,content,original_name,renamed_name",
    [
        ("json", '{"price":12,"name":"book"}', "price", "cost"),
        ("yaml", "price: 12\nname: book\n", "price", "cost"),
        (
            "xml",
            '<p:price xmlns:p="urn:shop" currency="USD">12.5</p:price>',
            {"namespaceUri": None, "localName": "currency"},
            {"namespaceUri": None, "localName": "cost"},
        ),
    ],
)
def test_analysis_edit_and_immutable_revisions_survive_server_restart(
    api, api_stack, document_format, content, original_name, renamed_name
):
    resource, analysis = analyze(api, content, document_format)
    schema = create_draft(api, resource, analysis)
    collection, member = editable_member(api, schema)
    assert member["name"] == original_name
    original_page = get_json(api, collection)
    changes = rename_changeset(member, "cost")
    schema_id = schema["snapshot"]["id"]
    response = api.post(
        schema["_links"]["changesets"]["href"],
        json=changes,
        headers={"If-Match": f'"{schema_id}:s1"'},
    )
    assert response.status_code == 201, response.text
    assert response.headers["etag"] == f'"{schema_id}:s2"'
    receipt = response.json()
    assert receipt["result"]["revision"] == "s2"
    latest = get_json(api, schema["_links"]["resource"]["href"])
    assert latest["revision"] == "s2"
    latest_manifest = get_json(api, latest["_links"]["manifest"]["href"])
    updated_collection, updated_member = editable_member(api, latest_manifest)
    assert updated_member["name"] == renamed_name
    assert updated_member["id"] == member["id"]
    assert get_json(api, collection) == original_page

    restart_server(api_stack)

    with httpx.Client(
        base_url=api_stack.api_url, timeout=30, trust_env=False
    ) as reopened:
        assert get_json(reopened, resource["_links"]["self"]["href"]) == resource
        assert get_json(reopened, analysis["_links"]["self"]["href"]) == analysis
        assert get_json(reopened, schema["_links"]["self"]["href"]) == schema
        assert get_json(reopened, schema["_links"]["resource"]["href"]) == latest
        assert get_json(reopened, receipt["result"]["manifestUrl"]) == latest_manifest
        assert get_json(reopened, response.headers["location"]) == receipt
        assert get_json(reopened, collection) == original_page
        assert (
            get_json(reopened, updated_collection)["items"][0]["member"]["name"]
            == renamed_name
        )
        listed = next(
            item
            for item in get_json(reopened, "/api/v2/schemas")
            if item["id"] == schema_id
        )
        assert listed["revision"] == "s2"
        assert listed["document_count"] == 1
