import base64
import binascii
import hmac
import json
from dataclasses import dataclass

from app.ports.tools.oidc_login import OidcLoginTool
from app.use_cases.start_login import safe_return_to

from .complete_login_error import CompleteLoginError


@dataclass(frozen=True)
class LoginResult:
    """Carry the token to store in the session cookie and where to go next."""

    access_token: str
    expires_in: int
    return_to: str


class CompleteLogin:
    """Finish an authorization code flow if the callback matches the stored state."""

    def __init__(self, login: OidcLoginTool) -> None:
        self._login = login

    def execute(self, code: str, state: str, flow: str | None) -> LoginResult:
        if not flow or not code:
            raise CompleteLoginError("Login flow is missing.")

        try:
            stored = json.loads(base64.urlsafe_b64decode(flow.encode()))
            expected = str(stored["state"])
            verifier = str(stored["verifier"])
            return_to = safe_return_to(stored.get("returnTo"))
        except (ValueError, KeyError, TypeError, binascii.Error) as error:
            raise CompleteLoginError("Login flow is malformed.") from error

        if not hmac.compare_digest(expected.encode(), state.encode()):
            raise CompleteLoginError("Login state does not match.")

        grant = self._login.exchange_code(code, verifier)

        return LoginResult(grant.access_token, grant.expires_in, return_to)
