from typing import Protocol

from core.entities import ResourceChange


class CacheInvalidationTool(Protocol):
    """Make downstream caches forget everything derived from changed resources."""

    def invalidate(self, changes: list[ResourceChange]) -> None: ...
