import base64
import json
from typing import Any

from app.ports.tools.identity_cache import IdentityCache

USER_EVENTS = frozenset(
    {
        "user.deactivated",
        "user.locked",
        "user.removed",
        "user.token.removed",
        "user.human.refresh.token.removed",
    }
)
GRANT_EVENTS = frozenset(
    {
        "user.grant.changed",
        "user.grant.removed",
        "user.grant.deactivated",
        "user.grant.cascade.changed",
        "user.grant.cascade.removed",
    }
)
ROLE_EVENTS = frozenset({"project.role.removed", "project.role.changed"})
OIDC_SESSION_REVOCATIONS = frozenset(
    {"oidc_session.access_token.revoked", "oidc_session.refresh_token.revoked"}
)


class ApplyIdentityEvent:
    """Turn identity provider events into cache flushes; every step is idempotent."""

    def __init__(self, cache: IdentityCache) -> None:
        self._cache = cache

    def execute(self, event: dict[str, Any]) -> None:
        """Apply one event; unknown event types are ignored."""
        kind = event.get("event_type")
        aggregate = str(event.get("aggregateID") or "")
        actor = str(event.get("userID") or "")

        if kind == "oidc_session.added":
            self._link(aggregate, actor, event)
        elif kind in OIDC_SESSION_REVOCATIONS:
            self._flush(self._cache.subject_of_oidc_session(aggregate))
        elif kind == "session.terminated":
            self._flush(self._cache.subject_of_session(aggregate))
        elif kind in USER_EVENTS:
            if aggregate:
                self._cache.flush_subject(aggregate)
        elif kind in GRANT_EVENTS:
            subject = self._payload(event).get("userId")

            if subject:
                self._cache.flush_subject(str(subject))
            else:
                self._cache.flush_all()
        elif kind in ROLE_EVENTS:
            self._cache.flush_all()

    def _link(self, oidc_session_id: str, actor: str, event: dict[str, Any]) -> None:
        subject = str(self._payload(event).get("userID") or actor)

        if not subject:
            return

        if oidc_session_id:
            self._cache.link_oidc_session(oidc_session_id, subject)

        session_id = self._payload(event).get("sessionID")

        if session_id:
            self._cache.link_session(str(session_id), subject)

    def _flush(self, subject: str | None) -> None:
        """Forget one subject, or everything when the session owner is unknown."""
        if subject:
            self._cache.flush_subject(subject)
        else:
            self._cache.flush_all()

    @staticmethod
    def _payload(event: dict[str, Any]) -> dict[str, Any]:
        payload = event.get("event_payload")

        if isinstance(payload, str):
            try:
                payload = json.loads(base64.b64decode(payload, validate=True))
            except ValueError:
                try:
                    payload = json.loads(payload)
                except ValueError:
                    return {}

        return payload if isinstance(payload, dict) else {}
