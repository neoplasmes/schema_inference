import base64
import hashlib
import json
import secrets
from dataclasses import dataclass

from app.ports.tools.oidc_login import OidcLoginTool


@dataclass(frozen=True)
class LoginRedirect:
    """Carry where to send the browser and the state to keep until it returns."""

    url: str
    flow: str


def safe_return_to(value: str | None) -> str:
    """Accept only same-site relative paths so a login cannot redirect off-site."""
    if (
        not value
        or not value.startswith("/")
        or value.startswith("//")
        or "\\" in value
        or any(ord(character) < 32 or ord(character) == 127 for character in value)
    ):
        return "/"

    return value


class StartLogin:
    """Begin an authorization code flow protected by state and PKCE."""

    def __init__(self, login: OidcLoginTool) -> None:
        self._login = login

    def execute(self, return_to: str | None) -> LoginRedirect:
        state = secrets.token_urlsafe(24)
        verifier = secrets.token_urlsafe(48)
        challenge = (
            base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
            .rstrip(b"=")
            .decode()
        )
        flow = {
            "state": state,
            "verifier": verifier,
            "returnTo": safe_return_to(return_to),
        }
        encoded = base64.urlsafe_b64encode(json.dumps(flow).encode()).decode()

        return LoginRedirect(self._login.authorization_url(state, challenge), encoded)
