import base64
import binascii
import json
from typing import Any

from app.ports.repos.workspace import WorkspaceError, WorkspaceRepository
from app.ports.uow.workspace import WorkspaceUow


class ReadWorkspace:
    """Read current resources or bounded slices of immutable snapshots."""

    def __init__(self, store: WorkspaceUow) -> None:
        self._store = store

    def resource(self, kind: str, identifier: str) -> dict[str, Any]:
        with self._store.read() as repository:
            return repository.resource(kind, identifier)

    def schemas(self) -> list[dict[str, Any]]:
        with self._store.read() as repository:
            return sorted(
                repository.resources("schema"),
                key=lambda item: item["updated_at"],
                reverse=True,
            )

    def analysis_manifest(self, identifier: str, revision: str) -> dict[str, Any]:
        with self._store.read() as repository:
            resource = repository.resource("analysis", identifier)

            if resource["revision"] != revision:
                raise WorkspaceError("not_found", "Analysis revision does not exist.")

            if resource["status"] != "completed":
                raise WorkspaceError("not_ready", "Analysis has not completed.")

            return repository.analysis_result(identifier)["manifest"]

    def manifest(self, identifier: str, revision: str) -> dict[str, Any]:
        with self._store.read() as repository:
            return repository.manifest(identifier, revision)

    def node(self, identifier: str, revision: str, node_id: str) -> dict[str, Any]:
        with self._store.read() as repository:
            return repository.node(identifier, revision, node_id)

    def receipt(self, identifier: str, mutation_id: str) -> dict[str, Any]:
        with self._store.read() as repository:
            return repository.receipt(identifier, mutation_id)

    def page(
        self,
        identifier: str,
        revision: str,
        collection_id: str,
        limit: int,
        cursor: str | None,
    ) -> dict[str, Any]:
        identity = [identifier, revision, collection_id, limit]
        offset = 0

        if cursor is not None:
            try:
                decoded = json.loads(base64.urlsafe_b64decode(cursor.encode()))

                if (
                    not isinstance(decoded, list)
                    or len(decoded) != 5
                    or decoded[:4] != identity
                    or type(decoded[4]) is not int
                    or decoded[4] < 0
                ):
                    raise ValueError("Cursor belongs to another collection page.")

                offset = decoded[4]
            except (ValueError, UnicodeError, binascii.Error) as error:
                raise WorkspaceError(
                    "invalid_cursor", "Invalid collection cursor."
                ) from error

        with self._store.read() as repository:
            members, total = repository.page(
                identifier, revision, collection_id, offset, limit
            )

            if offset > total:
                raise WorkspaceError(
                    "invalid_cursor", "Cursor is outside this collection."
                )

            items = []

            for member in members:
                node = repository.node(identifier, revision, member["valueNodeId"])
                label = (
                    node.get("name", {}).get("localName")
                    or node.get("scalarType")
                    or node["kind"]
                )
                count = _direct_member_count(repository, identifier, revision, node)
                items.append(
                    {
                        "member": member,
                        "valueSummary": {
                            "id": node["id"],
                            "kind": node["kind"],
                            "label": label,
                            "directMemberCount": count,
                            "descendantCount": None,
                        },
                    }
                )

        next_cursor = (
            base64.urlsafe_b64encode(
                json.dumps([*identity, offset + len(items)]).encode()
            ).decode()
            if offset + len(items) < total
            else None
        )

        return {
            "contractVersion": 2,
            "snapshot": {"resource": "schema", "id": identifier, "revision": revision},
            "collectionId": collection_id,
            "scopeId": None,
            "items": items,
            "totalItems": total,
            "nextCursor": next_cursor,
        }


def _direct_member_count(
    repository: WorkspaceRepository,
    identifier: str,
    revision: str,
    node: dict[str, Any],
) -> int:
    count = 0
    seen: set[str] = set()

    while node["id"] not in seen and len(seen) < 128:
        seen.add(node["id"])
        count += sum(
            node[field]["totalItems"]
            for field in ("properties", "options", "attributes", "particles")
            if field in node
        )
        next_id = (
            node.get("contentNodeId")
            or node.get("particleNodeId")
            or node.get("simpleContentNodeId")
            or node.get("itemsNodeId")
        )

        if next_id is None:
            break

        node = repository.node(identifier, revision, next_id)

    return count
