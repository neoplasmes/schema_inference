import logging
import re

from app.ports.tools.identity_cache import IdentityCache, IdentityCacheError
from app.ports.uow.workspace import WorkspaceUow
from core.entities import Principal

logger = logging.getLogger(__name__)

RESOURCE_PATH = re.compile(r"^/api/v2/(schemas|analyses)/([^/?#]+)")
KINDS = {"schemas": "schema", "analyses": "analysis"}


class AuthorizeRequest:
    """Decide whether a principal may touch the resource a forwarded request targets."""

    def __init__(self, store: WorkspaceUow, cache: IdentityCache) -> None:
        self._store = store
        self._cache = cache

    def execute(self, principal: Principal, uri: str) -> bool:
        """Return False when the target does not exist for this principal.

        Requests outside a single schema or analysis are not owner-scoped here,
        and administrators may reach every resource.
        """
        match = RESOURCE_PATH.match(uri)

        if match is None or principal.is_admin:
            return True

        kind = KINDS[match.group(1)]
        owner = self._owner(kind, match.group(2))

        return owner is not None and owner == principal.subject

    def _owner(self, kind: str, identifier: str) -> str | None:
        try:
            cached = self._cache.get_owner(kind, identifier)
        except IdentityCacheError:
            logger.warning("Owner cache read failed", exc_info=True)
            cached = None

        if cached is not None:
            return cached

        with self._store.read() as repository:
            owner = repository.owner(kind, identifier)

        if owner is not None:
            try:
                self._cache.put_owner(kind, identifier, owner)
            except IdentityCacheError:
                logger.warning("Owner cache write failed", exc_info=True)

        return owner
