from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class TokenGrant:
    """Carry the access token obtained for a login and its lifetime in seconds."""

    access_token: str
    expires_in: int


class OidcLoginTool(Protocol):
    """Drive the authorization code flow with PKCE against the identity provider."""

    def authorization_url(self, state: str, code_challenge: str) -> str: ...
    def exchange_code(self, code: str, code_verifier: str) -> TokenGrant: ...
    def end_session_url(self) -> str: ...
    def revoke(self, token: str) -> None:
        """Revoke a token issued to the web application at the provider."""
        ...
