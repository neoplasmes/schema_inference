import hashlib
import logging
import time
from collections.abc import Callable

from app.ports.tools.identity_cache import IdentityCache, IdentityCacheError
from app.ports.tools.token_introspection import TokenIntrospectionTool
from core.entities import Identity, Principal

logger = logging.getLogger(__name__)


def hash_token(token: str) -> str:
    """Return the digest under which a token is cached, never the token itself."""
    return hashlib.sha256(token.encode()).hexdigest()


class AuthenticateToken:
    """Resolve an opaque access token into a principal, caching what the provider said."""

    def __init__(
        self,
        introspection: TokenIntrospectionTool,
        cache: IdentityCache,
        cache_ttl: int,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._introspection = introspection
        self._cache = cache
        self._cache_ttl = cache_ttl
        self._clock = clock

    def execute(self, token: str) -> Principal | None:
        """Return the principal for an active token, or None when it is not valid."""
        digest = hash_token(token)
        now = self._clock()
        started_at = int(now * 1000)

        if self._ended(digest):
            return None

        identity = self._cached(digest)

        if identity is not None and (
            identity.expires_at <= 0 or identity.expires_at > now
        ):
            return self._principal(identity)

        identity = self._introspection.introspect(token)

        if identity is None:
            return None

        self._remember(digest, identity, now, started_at)

        return self._principal(identity)

    def _ended(self, digest: str) -> bool:
        try:
            return self._cache.is_token_dead(digest)
        except IdentityCacheError:
            logger.warning("Identity cache read failed", exc_info=True)

            return False

    def _cached(self, digest: str) -> Identity | None:
        try:
            return self._cache.get_token(digest)
        except IdentityCacheError:
            logger.warning("Identity cache read failed", exc_info=True)

            return None

    def _remember(
        self, digest: str, identity: Identity, now: float, started_at: int
    ) -> None:
        lifetime = int(identity.expires_at - now) if identity.expires_at > 0 else 0
        ttl = min(lifetime, self._cache_ttl) if lifetime > 0 else self._cache_ttl

        if identity.expires_at > 0 and lifetime <= 0:
            return

        try:
            self._cache.put_token(digest, identity, ttl, started_at)
        except IdentityCacheError:
            logger.warning("Identity cache write failed", exc_info=True)

    @staticmethod
    def _principal(identity: Identity) -> Principal:
        return Principal(identity.subject, identity.roles)
