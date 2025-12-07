from typing import Protocol

from core.entities import Identity


class TokenIntrospectionTool(Protocol):
    """Ask the identity provider whether an opaque access token is still valid."""

    def introspect(self, token: str) -> Identity | None:
        """Return the token's identity, or None when it is inactive."""
        ...

    def revoke(self, token: str) -> None: ...
