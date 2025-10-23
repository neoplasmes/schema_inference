import re
from copy import deepcopy
from typing import Any

from core.entities.schema_draft import SchemaGraph

COLLECTIONS = {
    "object": ("properties", "property"),
    "union": ("options", "option"),
    "xmlComplex": ("attributes", "xmlAttribute"),
    "xmlGroup": ("particles", "xmlParticle"),
}


def apply_schema_changes(
    graph: SchemaGraph, operations: list[dict[str, Any]]
) -> SchemaGraph:
    """Apply a complete ordered batch without mutating its base revision."""
    result = deepcopy(graph)
    owners = {
        node[field]["id"]: (node, field, member_kind)
        for node in result.nodes.values()
        if (pair := COLLECTIONS.get(node["kind"]))
        for field, member_kind in [pair]
    }

    def member(identifier: str):
        for collection_id, items in result.collections.items():
            for item in items:
                if item["id"] == identifier:
                    return collection_id, item

        raise ValueError("Member does not exist.")

    def unique(collection_id: str) -> None:
        names = [
            item["name"]
            if item["kind"] == "property"
            else (item["name"]["namespaceUri"], item["name"]["localName"])
            for item in result.collections[collection_id]
            if item["kind"] in ("property", "xmlAttribute")
        ]

        # A property or attribute name addresses one field within its owner.
        if len(names) != len(set(names)):
            raise ValueError("A field with this name already exists.")

    for operation in operations:
        kind = operation["kind"]

        if kind == "renameProperty":
            collection_id, target = member(operation["memberId"])

            if target["kind"] != "property" or not operation["name"].strip():
                raise ValueError("Only properties accept a nonempty property name.")

            target["name"] = operation["name"]
            unique(collection_id)
        elif kind == "renameXmlName":
            name = operation["name"]

            if (
                not re.fullmatch(r"[^\W\d][\w.\-]*", name["localName"], re.UNICODE)
                or name["localName"].lower().startswith("xml")
                and name["namespaceUri"] == "http://www.w3.org/2000/xmlns/"
            ):
                raise ValueError("Invalid XML local name.")

            address = operation["target"]
            collection_id = None

            if address["kind"] == "node":
                target = result.nodes.get(address["id"], {})

                if target.get("kind") != "xmlElement":
                    raise ValueError("Only XML elements can be renamed as nodes.")
            else:
                collection_id, target = member(address["id"])

                if target["kind"] != "xmlAttribute":
                    raise ValueError("Only XML attributes can be renamed as members.")

            target["name"] = name

            if collection_id is not None:
                unique(collection_id)
        elif kind == "moveMember":
            source_id, target = member(operation["memberId"])
            destination = operation["targetCollectionId"]

            if destination not in owners or owners[destination][2] != target["kind"]:
                raise ValueError("This collection cannot own this member kind.")

            before = operation["beforeMemberId"]
            destination_items = result.collections[destination]

            if before == target["id"] and source_id == destination:
                continue

            if before is not None and not any(
                item["id"] == before for item in destination_items
            ):
                raise ValueError(
                    "The insertion position does not belong to the destination."
                )

            # Moving a field into its own descendant would make a document cyclic.
            if _contains(result, target["valueNodeId"], owners[destination][0]["id"]):
                raise ValueError("A member cannot move into its own subtree.")

            result.collections[source_id].remove(target)
            position = (
                len(destination_items)
                if before is None
                else next(
                    index
                    for index, item in enumerate(destination_items)
                    if item["id"] == before
                )
            )
            destination_items.insert(position, target)
            unique(destination)

            for collection_id in {source_id, destination}:
                node, field, _ = owners[collection_id]
                node[field]["totalItems"] = len(result.collections[collection_id])
        else:
            raise ValueError("Unsupported operation.")

    return result


def _contains(graph: SchemaGraph, root: str, target: str) -> bool:
    pending = [root]
    visited = set()

    while pending:
        current = pending.pop()

        if current == target:
            return True

        if current in visited:
            continue

        visited.add(current)
        node = graph.nodes[current]
        pending.extend(
            node[key]
            for key in (
                "itemsNodeId",
                "contentNodeId",
                "particleNodeId",
                "simpleContentNodeId",
            )
            if node.get(key)
        )
        collection = COLLECTIONS.get(node["kind"])

        if collection:
            pending.extend(
                member["valueNodeId"]
                for member in graph.collections[node[collection[0]]["id"]]
            )

    return False
