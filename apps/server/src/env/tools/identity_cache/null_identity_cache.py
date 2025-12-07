from core.entities import Identity


class NullIdentityCache:
    """Remember nothing, so every request is introspected and owners are read from the store."""

    def get_token(self, token_hash: str) -> Identity | None:
        return None

    def put_token(
        self, token_hash: str, identity: Identity, ttl: int, started_at: int
    ) -> bool:
        return False

    def delete_token(self, token_hash: str) -> None:
        return None

    def is_token_dead(self, token_hash: str) -> bool:
        return False

    def flush_subject(self, subject: str) -> None:
        return None

    def flush_all(self) -> None:
        return None

    def link_oidc_session(self, oidc_session_id: str, subject: str) -> None:
        return None

    def link_session(self, session_id: str, subject: str) -> None:
        return None

    def subject_of_oidc_session(self, oidc_session_id: str) -> str | None:
        return None

    def subject_of_session(self, session_id: str) -> str | None:
        return None

    def get_owner(self, kind: str, identifier: str) -> str | None:
        return None

    def put_owner(self, kind: str, identifier: str, owner: str) -> None:
        return None

    def delete_owner(self, kind: str, identifier: str) -> None:
        return None
