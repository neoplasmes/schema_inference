from app.ports.tools.cache_invalidation import CacheInvalidationTool
from app.ports.uow.workspace import WorkspaceUow


class DispatchChanges:
    """Deliver queued resource changes to caches, forgetting them only after success."""

    def __init__(
        self, store: WorkspaceUow, invalidation: CacheInvalidationTool
    ) -> None:
        self._store = store
        self._invalidation = invalidation

    def execute(self, limit: int = 100) -> int:
        """Drain up to ``limit`` changes and return how many rows were claimed.

        A failing tool aborts the transaction, so the claimed rows stay queued.
        """
        with self._store.transaction() as repository:
            claimed = repository.claim_changes(limit)

            if not claimed:
                return 0

            self._invalidation.invalidate(
                list(dict.fromkeys(change for _, change in claimed))
            )
            repository.delete_changes([identifier for identifier, _ in claimed])

            return len(claimed)
