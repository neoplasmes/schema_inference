from app.ports.repos.workspace import WorkspaceError
from app.ports.uow.workspace import WorkspaceUow
from app.use_cases.workspace_support import authorize
from core.entities import Principal


class DeleteAnalysis:
    """Remove a finished analysis and its result, keeping schemas drafted from it."""

    def __init__(self, store: WorkspaceUow) -> None:
        self._store = store

    def execute(self, identifier: str, principal: Principal) -> None:
        with self._store.transaction() as repository:
            authorize(repository, principal, "analysis", identifier)
            current = repository.resource("analysis", identifier)

            if current["status"] in ("queued", "processing"):
                raise WorkspaceError("not_ready", "Analysis has not finished.")

            repository.delete_resource("analysis", identifier)
