from http.client import HTTPException
from urllib.error import URLError
from urllib.parse import urlencode, urlsplit

from app.ports.tools.oidc_login import OidcLoginError, TokenGrant
from shared.utils import basic_authorization, post_form


class ZitadelOidcLoginTool:
    """Run the authorization code flow as the ZITADEL web application.

    Browser redirects use the public issuer; the code exchange goes to the
    internal base URL with the issuer's host name in the ``Host`` header.
    """

    def __init__(
        self,
        issuer: str,
        internal_url: str,
        client_id: str,
        client_secret: str,
        project_id: str,
        redirect_uri: str,
        post_logout_uri: str,
        timeout: float = 5.0,
    ) -> None:
        self._issuer = issuer.rstrip("/")
        self._base = internal_url.rstrip("/")
        self._client_id = client_id
        self._client_secret = client_secret
        self._redirect_uri = redirect_uri
        self._post_logout_uri = post_logout_uri
        self._host = urlsplit(issuer).netloc
        self._scope = " ".join(
            [
                "openid",
                "profile",
                "email",
                f"urn:zitadel:iam:org:project:id:{project_id}:aud",
                "urn:zitadel:iam:org:project:roles",
            ]
        )
        self._timeout = timeout

    def authorization_url(self, state: str, code_challenge: str) -> str:
        query = urlencode(
            {
                "client_id": self._client_id,
                "redirect_uri": self._redirect_uri,
                "response_type": "code",
                "scope": self._scope,
                "state": state,
                "code_challenge": code_challenge,
                "code_challenge_method": "S256",
            }
        )

        return f"{self._issuer}/oauth/v2/authorize?{query}"

    def exchange_code(self, code: str, code_verifier: str) -> TokenGrant:
        fields = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": self._redirect_uri,
            "code_verifier": code_verifier,
        }
        headers = {
            "Host": self._host,
            "Authorization": basic_authorization(self._client_id, self._client_secret),
            "Accept": "application/json",
        }

        try:
            answer = post_form(
                f"{self._base}/oauth/v2/token", fields, headers, self._timeout
            )
            token = str(answer["access_token"])

            return TokenGrant(token, int(answer.get("expires_in") or 0))
        except (URLError, OSError, HTTPException, ValueError, KeyError) as error:
            raise OidcLoginError(f"Code exchange failed: {error}") from error

    def revoke(self, token: str) -> None:
        """Revoke a token issued to the web application at the provider."""
        headers = {
            "Host": self._host,
            "Authorization": basic_authorization(self._client_id, self._client_secret),
            "Accept": "application/json",
        }

        try:
            post_form(
                f"{self._base}/oauth/v2/revoke",
                {"token": token, "token_type_hint": "access_token"},
                headers,
                self._timeout,
            )
        except (URLError, OSError, HTTPException, ValueError) as error:
            raise OidcLoginError(f"Revocation failed: {error}") from error

    def end_session_url(self) -> str:
        query = urlencode(
            {
                "client_id": self._client_id,
                "post_logout_redirect_uri": self._post_logout_uri,
            }
        )

        return f"{self._issuer}/oidc/v1/end_session?{query}"
