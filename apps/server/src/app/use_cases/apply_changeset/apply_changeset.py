from typing import Any

from app.ports.repos.workspace import WorkspaceError
from app.ports.uow.workspace import WorkspaceUow
from app.use_cases.workspace_support import digest, timestamp
from core.processes.apply_schema_changes import apply_schema_changes


class ApplyChangeset:
    """Persist a complete document edit and its retry receipt in one transaction."""

    def __init__(self, store: WorkspaceUow) -> None:
        self._store = store

    def execute(
        self, identifier: str, body: dict[str, Any], if_match: str | None
    ) -> dict[str, Any]:
        mutation = body["clientMutationId"]
        fingerprint = digest(body)
        scope = f"changesets:{identifier}"

        with self._store.transaction() as repository:
            replay = repository.replay(scope, mutation, fingerprint)

            if replay is not None:
                return repository.receipt(identifier, replay)

            current = repository.resource("schema", identifier)

            if if_match is None:
                raise WorkspaceError(
                    "precondition_required", "Supply the schema ETag in If-Match."
                )

            if (
                if_match != f'"{identifier}:{current["revision"]}"'
                or body["baseRevision"] != current["revision"]
            ):
                raise WorkspaceError(
                    "revision_conflict",
                    "The schema changed since this revision was read.",
                )

            manifest = repository.manifest(identifier, current["revision"])
            graph = repository.graph(identifier, current["revision"])

            try:
                updated = apply_schema_changes(graph, body["operations"])
            except ValueError as error:
                raise WorkspaceError("invalid_input", str(error)) from error

            revision = f"s{int(current['revision'][1:]) + 1}"
            manifest["snapshot"]["revision"] = revision
            receipt = {
                "id": mutation,
                "clientMutationId": mutation,
                "status": "applied",
                "baseRevision": body["baseRevision"],
                "result": {
                    "revision": revision,
                    "manifestUrl": f"/api/v2/schemas/{identifier}/revisions/{revision}/manifest",
                },
            }
            repository.save_revision(manifest, updated)
            repository.put_resource(
                "schema", {**current, "revision": revision, "updated_at": timestamp()}
            )
            repository.put_receipt(identifier, receipt)
            repository.remember(scope, mutation, fingerprint, mutation)

            return receipt
