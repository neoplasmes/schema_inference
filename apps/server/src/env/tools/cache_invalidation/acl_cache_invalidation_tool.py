from app.ports.tools.cache_invalidation import CacheInvalidationError
from app.ports.tools.identity_cache import IdentityCache, IdentityCacheError
from core.entities import ResourceChange


class AclCacheInvalidationTool:
    """Forget cached owners of changed resources so access checks see the new truth."""

    def __init__(self, cache: IdentityCache) -> None:
        self._cache = cache

    def invalidate(self, changes: list[ResourceChange]) -> None:
        try:
            for change in changes:
                self._cache.delete_owner(change.kind, change.resource_id)
        except IdentityCacheError as error:
            raise CacheInvalidationError(str(error)) from error
