from typing import Any
from urllib.parse import quote


def resource_links(kind: str, value: dict[str, Any]) -> dict[str, Any]:
    identifier = value["id"]
    collection = "analyses" if kind == "analysis" else "schemas"
    path = f"/api/v2/{collection}/{identifier}"
    links = {"self": {"href": path}}

    if kind == "schema" or value["status"] == "completed":
        links["manifest"] = {"href": f"{path}/revisions/{value['revision']}/manifest"}

    if kind == "schema":
        links["changesets"] = {"href": f"{path}/changesets"}

    return {**value, "_links": links}


def manifest_links(value: dict[str, Any]) -> dict[str, Any]:
    snapshot = value["snapshot"]
    kind = snapshot["resource"]
    collection = "analyses" if kind == "analysis" else "schemas"
    path = f"/api/v2/{collection}/{snapshot['id']}"
    revision = f"{path}/revisions/{snapshot['revision']}"
    links = {"self": {"href": f"{revision}/manifest"}, "resource": {"href": path}}

    if kind == "analysis":
        links["drafts"] = {"href": "/api/v2/schemas"}
    else:
        links["root"] = {
            "href": f"{revision}/nodes/{quote(value['rootNodeId'], safe='')}"
        }
        links["changesets"] = {"href": f"{path}/changesets"}

    return {**value, "_links": links}


def node_links(value: dict[str, Any], identifier: str, revision: str) -> dict[str, Any]:
    path = f"/api/v2/schemas/{identifier}/revisions/{revision}"
    links = {"self": {"href": f"{path}/nodes/{quote(value['id'], safe='')}"}}

    for field in ("properties", "options", "attributes", "particles"):
        if field in value:
            links[field] = {
                "href": f"{path}/collections/{quote(value[field]['id'], safe='')}/items"
            }

    for field in (
        "itemsNodeId",
        "contentNodeId",
        "particleNodeId",
        "simpleContentNodeId",
    ):
        if value.get(field):
            links[field] = {"href": f"{path}/nodes/{quote(value[field], safe='')}"}

    return {**value, "_links": links}


def receipt_links(value: dict[str, Any], identifier: str) -> dict[str, Any]:
    return {
        **value,
        "_links": {
            "self": {"href": f"/api/v2/schemas/{identifier}/changesets/{value['id']}"},
            "result": {"href": value["result"]["manifestUrl"]},
        },
    }
