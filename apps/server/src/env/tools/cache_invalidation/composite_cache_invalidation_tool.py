from app.ports.tools.cache_invalidation import (
    CacheInvalidationError,
    CacheInvalidationTool,
)
from core.entities import ResourceChange


class CompositeCacheInvalidationTool:
    """Forward changes to every listener, failing only after all were tried."""

    def __init__(self, tools: list[CacheInvalidationTool]) -> None:
        self._tools = list(tools)

    def invalidate(self, changes: list[ResourceChange]) -> None:
        failures: list[str] = []

        for tool in self._tools:
            try:
                tool.invalidate(changes)
            except CacheInvalidationError as error:
                failures.append(str(error))

        if failures:
            raise CacheInvalidationError("; ".join(failures))
