from core.entities import ResourceChange


class NullCacheInvalidationTool:
    """Accept every change when no cache sits in front of the server."""

    def invalidate(self, changes: list[ResourceChange]) -> None:
        return None
