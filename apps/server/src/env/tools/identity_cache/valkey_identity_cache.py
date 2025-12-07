import json
import time
from collections.abc import Callable
from typing import Any, cast

from redis import Redis
from redis.exceptions import RedisError

from app.ports.tools.identity_cache import IdentityCacheError
from core.entities import Identity

LINK_TTL = 30 * 24 * 3600
OWNER_TTL = 300
MARKER_TTL = 3600
DEAD_TTL = 12 * 3600

PUT_TOKEN_SCRIPT = """
local started = tonumber(ARGV[3])
for i = 3, 4 do
    local marker = redis.call('GET', KEYS[i])
    if marker and tonumber(marker) >= started then
        return 0
    end
end
if redis.call('EXISTS', KEYS[5]) == 1 then
    return 0
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
redis.call('SADD', KEYS[2], ARGV[4])
local remaining = redis.call('TTL', KEYS[2])
if remaining < tonumber(ARGV[2]) then
    redis.call('EXPIRE', KEYS[2], ARGV[2])
end
return 1
"""


class ValkeyIdentityCache:
    """Keep introspected identities, session links and resource owners in Valkey."""

    def __init__(
        self,
        client: Redis,
        marker_ttl: int = MARKER_TTL,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._client = client
        self._marker_ttl = marker_ttl
        self._clock = clock
        self._put_script = client.register_script(PUT_TOKEN_SCRIPT)

    @classmethod
    def from_url(
        cls, url: str, timeout: float = 2.0, marker_ttl: int = MARKER_TTL
    ) -> "ValkeyIdentityCache":
        return cls(
            Redis.from_url(
                url,
                decode_responses=True,
                socket_timeout=timeout,
                socket_connect_timeout=timeout,
            ),
            marker_ttl,
        )

    def get_token(self, token_hash: str) -> Identity | None:
        raw = self._call(lambda: self._client.get(f"auth:token:{token_hash}"))

        if raw is None:
            return None

        try:
            data = json.loads(raw)

            return Identity(
                subject=data["sub"],
                roles=frozenset(data["roles"]),
                expires_at=int(data["exp"]),
                token_id=data.get("jti", ""),
                client_id=data.get("client_id", ""),
            )
        except (ValueError, KeyError, TypeError) as error:
            raise IdentityCacheError("Cached identity is malformed.") from error

    def put_token(
        self, token_hash: str, identity: Identity, ttl: int, started_at: int
    ) -> bool:
        """Store the identity in one script unless a revocation marker reaches ``started_at``."""
        value = json.dumps(
            {
                "sub": identity.subject,
                "roles": sorted(identity.roles),
                "exp": identity.expires_at,
                "jti": identity.token_id,
                "client_id": identity.client_id,
            }
        )
        keys = [
            f"auth:token:{token_hash}",
            f"auth:user:{identity.subject}",
            f"auth:revoked:{identity.subject}",
            "auth:revoked",
            f"auth:dead:{token_hash}",
        ]

        stored = self._call(
            lambda: self._put_script(
                keys=keys, args=[value, ttl, started_at, token_hash]
            )
        )

        return bool(stored)

    def delete_token(self, token_hash: str) -> None:
        key = f"auth:token:{token_hash}"

        def delete() -> None:
            self._client.set(f"auth:dead:{token_hash}", "1", ex=DEAD_TTL)
            identity = self.get_token(token_hash)

            if identity is not None:
                self._client.srem(f"auth:user:{identity.subject}", token_hash)

            self._client.delete(key)

        self._call(delete)

    def is_token_dead(self, token_hash: str) -> bool:
        return bool(self._call(lambda: self._client.exists(f"auth:dead:{token_hash}")))

    def flush_subject(self, subject: str) -> None:
        index = f"auth:user:{subject}"

        def flush() -> None:
            self._mark(f"auth:revoked:{subject}")
            hashes = cast(set[str], self._client.smembers(index))
            keys = [f"auth:token:{item}" for item in hashes]
            self._client.delete(index, *keys)

        self._call(flush)

    def flush_all(self) -> None:
        def flush() -> None:
            self._mark("auth:revoked")

            for pattern in ("auth:token:*", "auth:user:*"):
                for key in self._client.scan_iter(match=pattern, count=500):
                    self._client.delete(key)

        self._call(flush)

    def link_oidc_session(self, oidc_session_id: str, subject: str) -> None:
        self._call(
            lambda: self._client.set(
                f"auth:oidc:{oidc_session_id}", subject, ex=LINK_TTL
            )
        )

    def link_session(self, session_id: str, subject: str) -> None:
        self._call(
            lambda: self._client.set(f"auth:session:{session_id}", subject, ex=LINK_TTL)
        )

    def subject_of_oidc_session(self, oidc_session_id: str) -> str | None:
        return self._call(lambda: self._client.get(f"auth:oidc:{oidc_session_id}"))

    def subject_of_session(self, session_id: str) -> str | None:
        return self._call(lambda: self._client.get(f"auth:session:{session_id}"))

    def get_owner(self, kind: str, identifier: str) -> str | None:
        return self._call(lambda: self._client.get(f"acl:{kind}:{identifier}"))

    def put_owner(self, kind: str, identifier: str, owner: str) -> None:
        self._call(
            lambda: self._client.set(f"acl:{kind}:{identifier}", owner, ex=OWNER_TTL)
        )

    def delete_owner(self, kind: str, identifier: str) -> None:
        self._call(lambda: self._client.delete(f"acl:{kind}:{identifier}"))

    def _mark(self, key: str) -> None:
        self._client.set(key, int(self._clock() * 1000), ex=self._marker_ttl)

    @staticmethod
    def _call(operation: Callable[[], Any]) -> Any:
        try:
            return operation()
        except RedisError as error:
            raise IdentityCacheError(f"Valkey failed: {error}") from error
