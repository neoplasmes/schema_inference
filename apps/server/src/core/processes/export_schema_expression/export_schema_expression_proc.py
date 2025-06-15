from itertools import count
from typing import Any


def export_schema_expression(space: dict[str, Any]) -> dict[str, Any]:
    """Project counted variants into the existing editor's AND/OR expression format."""
    nodes = {node["id"]: node for node in space["nodes"]}
    result: dict[str, Any] = {}
    scopes = count(1)

    def expression(
        kind: str, probability: float = 1.0, **kwargs: Any
    ) -> dict[str, Any]:
        return {
            "type": kind,
            "value": "",
            "probability": probability,
            "minOccurs": 1,
            "maxOccurs": 1,
            "children": [],
            **kwargs,
        }

    def leaf(reference: dict, root: bool = False) -> dict:
        node = nodes[reference["node"]]
        variant = next(
            item
            for item in node["content"]["alternatives"]
            if item["id"] == reference["variant"]
        )
        is_parent = variant["kind"] == "fields"
        suffix = "c" if is_parent else "s"
        name = node["name"].rsplit("}", 1)[-1]
        key = (
            f"begin-c/{name}-{suffix}"
            if root
            else f"context{next(scopes)}-c/{name}-{suffix}"
        )
        children = [leaf(child) for child in variant["children"]]
        types = {
            item["value"]: item["probability"]
            for item in node["data_types"]
            if item["value"] != "parent"
        }
        total = sum(types.values())
        types = {
            (
                "empty" if name == "null" else "double" if name == "number" else name
            ): probability / total
            for name, probability in types.items()
        }
        body = expression("AND", children=children) if children else {}
        result[key] = {
            "expression": body if root else {},
            "typoSpace": {item["value"]: item["probability"] for item in node["typos"]},
            "semanticSpace": {
                item["value"]: item["probability"] for item in node["alternative_names"]
            },
            "XSDTypes": {"parent": 1.0} if is_parent else types,
            "attributes": {},
            "presence_probability": node["presence_probability"],
        }

        return expression("LEAF", value=key, children=[body] if body else [])

    roots = space["roots"]

    if len(roots) == 1:
        leaf(roots[0], root=True)
    elif roots:
        alternatives = []

        for reference in roots:
            branch = leaf(reference)
            branch["probability"] = reference["probability"]
            alternatives.append(branch)

        root_ids = {reference["node"] for reference in roots}

        if len(root_ids) == 1:
            node = nodes[next(iter(root_ids))]
            name = node["name"].rsplit("}", 1)[-1]
            branches = [
                expression("AND", branch["probability"], children=branch["children"])
                for branch in alternatives
            ]
            key = f"begin-c/{name}-c"
            result[key] = {
                "expression": expression("OR", children=branches),
                "typoSpace": {
                    item["value"]: item["probability"] for item in node["typos"]
                },
                "semanticSpace": {
                    item["value"]: item["probability"]
                    for item in node["alternative_names"]
                },
                "XSDTypes": {
                    item["value"]: item["probability"] for item in node["data_types"]
                },
                "attributes": {},
            }
        else:
            result["begin-c/documents-c"] = {
                "expression": expression("OR", children=alternatives),
                "typoSpace": {},
                "semanticSpace": {},
                "XSDTypes": {"parent": 1.0},
                "attributes": {},
            }

    return result
