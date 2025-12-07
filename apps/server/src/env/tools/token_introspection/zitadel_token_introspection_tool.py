import logging
from http.client import HTTPException
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit

from app.ports.tools.token_introspection import TokenIntrospectionError
from core.entities import Identity
from shared.utils import basic_authorization, post_form

ROLES_CLAIM = "urn:zitadel:iam:org:project:roles"

logger = logging.getLogger(__name__)


class ZitadelTokenIntrospectionTool:
    """Introspect and revoke opaque ZITADEL tokens as the API application.

    Requests go to the internal base URL while the ``Host`` header carries the
    public issuer, because ZITADEL resolves its instance from the host name.
    """

    def __init__(
        self,
        internal_url: str,
        issuer: str,
        client_id: str,
        client_secret: str,
        project_id: str = "",
        timeout: float = 5.0,
    ) -> None:
        self._base = internal_url.rstrip("/")
        self._headers = {
            "Host": urlsplit(issuer).netloc,
            "Authorization": basic_authorization(client_id, client_secret),
            "Accept": "application/json",
        }
        self._project_claim = (
            f"urn:zitadel:iam:org:project:{project_id}:roles" if project_id else ""
        )
        self._timeout = timeout

    def introspect(self, token: str) -> Identity | None:
        answer = self._post("/oauth/v2/introspect", {"token": token})

        if not answer.get("active") or not answer.get("sub"):
            return None

        roles: set[str] = set()

        for claim in (ROLES_CLAIM, self._project_claim):
            value = answer.get(claim)

            if isinstance(value, dict):
                roles.update(str(role) for role in value)

        return Identity(
            subject=str(answer["sub"]),
            roles=frozenset(roles),
            expires_at=int(answer.get("exp") or 0),
            token_id=str(answer.get("jti") or ""),
            client_id=str(answer.get("client_id") or ""),
        )

    def revoke(self, token: str) -> None:
        """Revoke a token at the provider, which refuses tokens of other clients.

        A refusal with 400 means the token was not issued to the API application,
        as with machine-user tokens; the caller still ends it locally.
        """
        try:
            self._post(
                "/oauth/v2/revoke", {"token": token, "token_type_hint": "access_token"}
            )
        except TokenIntrospectionError as error:
            cause = error.__cause__

            if isinstance(cause, HTTPError):
                cause.close()

            if not (isinstance(cause, HTTPError) and cause.code == 400):
                raise

            logger.warning("Provider refused to revoke the token: %s", error)

    def _post(self, path: str, fields: dict[str, str]) -> dict:
        try:
            return post_form(self._base + path, fields, self._headers, self._timeout)
        except (URLError, OSError, HTTPException, ValueError) as error:
            raise TokenIntrospectionError(f"POST {path} failed: {error}") from error
