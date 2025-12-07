import time
from collections.abc import Callable

from core.entities import Identity

TRUSTED_HEADERS = {"X-User-Id": "e2e", "X-User-Roles": "admin"}


class FakeIdentityCache:
    """Hold identities, links and owners in memory with the semantics of Valkey."""

    def __init__(self, clock: Callable[[], float] = time.time) -> None:
        self.clock = clock
        self.revoked: dict[str, int] = {}
        self.dead: set[str] = set()
        self.tokens: dict[str, Identity] = {}
        self.ttls: dict[str, int] = {}
        self.users: dict[str, set[str]] = {}
        self.oidc: dict[str, str] = {}
        self.sessions: dict[str, str] = {}
        self.owners: dict[tuple[str, str], str] = {}
        self.flushed_all = 0

    def get_token(self, token_hash: str) -> Identity | None:
        return self.tokens.get(token_hash)

    def put_token(
        self, token_hash: str, identity: Identity, ttl: int, started_at: int
    ) -> bool:
        markers = (self.revoked.get(identity.subject), self.revoked.get(""))

        if token_hash in self.dead or any(
            marker is not None and marker >= started_at for marker in markers
        ):
            return False

        self.tokens[token_hash] = identity
        self.ttls[token_hash] = ttl
        self.users.setdefault(identity.subject, set()).add(token_hash)

        return True

    def delete_token(self, token_hash: str) -> None:
        self.dead.add(token_hash)
        identity = self.tokens.pop(token_hash, None)

        if identity is not None:
            self.users.get(identity.subject, set()).discard(token_hash)

    def is_token_dead(self, token_hash: str) -> bool:
        return token_hash in self.dead

    def flush_subject(self, subject: str) -> None:
        self.revoked[subject] = int(self.clock() * 1000)
        for token_hash in self.users.pop(subject, set()):
            self.tokens.pop(token_hash, None)

    def flush_all(self) -> None:
        self.flushed_all += 1
        self.revoked[""] = int(self.clock() * 1000)
        self.tokens.clear()
        self.users.clear()

    def link_oidc_session(self, oidc_session_id: str, subject: str) -> None:
        self.oidc[oidc_session_id] = subject

    def link_session(self, session_id: str, subject: str) -> None:
        self.sessions[session_id] = subject

    def subject_of_oidc_session(self, oidc_session_id: str) -> str | None:
        return self.oidc.get(oidc_session_id)

    def subject_of_session(self, session_id: str) -> str | None:
        return self.sessions.get(session_id)

    def get_owner(self, kind: str, identifier: str) -> str | None:
        return self.owners.get((kind, identifier))

    def put_owner(self, kind: str, identifier: str, owner: str) -> None:
        self.owners[(kind, identifier)] = owner

    def delete_owner(self, kind: str, identifier: str) -> None:
        self.owners.pop((kind, identifier), None)


class FakeTokenIntrospection:
    """Answer introspection from a table of known tokens and record revocations."""

    def __init__(self, tokens: dict[str, Identity] | None = None) -> None:
        self.tokens = dict(tokens or {})
        self.introspected: list[str] = []
        self.revoked: list[str] = []
        self.after_introspect: Callable[[], None] | None = None

    def introspect(self, token: str) -> Identity | None:
        self.introspected.append(token)
        identity = self.tokens.get(token)

        if self.after_introspect is not None:
            self.after_introspect()

        return identity

    def revoke(self, token: str) -> None:
        self.revoked.append(token)
        self.tokens.pop(token, None)
