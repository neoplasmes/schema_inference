from app.ports.repos.workspace import WorkspaceError
from app.ports.uow.workspace import WorkspaceUow
from app.use_cases.workspace_support import authorize
from core.entities import Principal


class DeleteSchema:
    """Remove a schema with all its revisions once the caller proves its latest ETag."""

    def __init__(self, store: WorkspaceUow) -> None:
        self._store = store

    def execute(
        self, identifier: str, if_match: str | None, principal: Principal
    ) -> None:
        with self._store.transaction() as repository:
            authorize(repository, principal, "schema", identifier)
            current = repository.resource("schema", identifier)

            if if_match is None:
                raise WorkspaceError(
                    "precondition_required", "Supply the schema ETag in If-Match."
                )

            if if_match != f'"{identifier}:{current["revision"]}"':
                raise WorkspaceError(
                    "revision_conflict",
                    "The schema changed since this revision was read.",
                )

            repository.delete_resource("schema", identifier)
            repository.record_change("schema", identifier, deleted=True)
