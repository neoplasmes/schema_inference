from typing import Any

from app.ports.repos.workspace import WorkspaceError
from app.ports.uow.workspace import WorkspaceUow
from app.use_cases.workspace_support import digest, identifier, timestamp
from core.entities.schema_draft import SchemaGraph


class CreateDraft:
    """Create an independent editable snapshot of one observed analysis alternative."""

    def __init__(self, store: WorkspaceUow) -> None:
        self._store = store

    def execute(self, body: dict[str, Any], key: str) -> dict[str, Any]:
        fingerprint = digest(body)

        with self._store.transaction() as repository:
            replay = repository.replay("schemas", key, fingerprint)

            if replay is not None:
                return repository.manifest(replay, "s1")

            source = body["source"]
            analysis = repository.resource("analysis", source["analysisId"])

            if analysis["status"] != "completed":
                raise WorkspaceError("not_ready", "Analysis has not completed.")

            result = repository.analysis_result(analysis["id"])
            seed = result["manifest"]["suggestedDraft"]["seedId"]

            if (
                source["revision"] != analysis["revision"]
                or source["seedId"] != seed
                or source["rootAlternativeId"] not in result["alternatives"]
            ):
                raise WorkspaceError("not_found", "Analysis seed does not exist.")

            graph = SchemaGraph(
                **result["alternatives"][source["rootAlternativeId"]]["graph"]
            )
            schema_id = identifier("schema")
            manifest = {
                "contractVersion": 2,
                "format": "schema-draft",
                "snapshot": {"resource": "schema", "id": schema_id, "revision": "s1"},
                "title": body["title"],
                "profile": graph.profile,
                "rootNodeId": graph.root_node_id,
            }
            repository.put_resource(
                "schema",
                {
                    "id": schema_id,
                    "title": body["title"],
                    "revision": "s1",
                    "updated_at": timestamp(),
                    "document_count": len(analysis["documents"]),
                },
            )
            repository.save_revision(manifest, graph)
            repository.remember("schemas", key, fingerprint, schema_id)

            return manifest
