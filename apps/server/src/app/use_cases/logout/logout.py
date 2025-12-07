from app.ports.tools.identity_cache import IdentityCache
from app.ports.tools.oidc_login import OidcLoginTool
from app.ports.tools.token_introspection import TokenIntrospectionTool
from app.use_cases.authenticate_token import hash_token


class Logout:
    """End a session so the token stops working everywhere before the caller is answered."""

    def __init__(
        self,
        introspection: TokenIntrospectionTool,
        cache: IdentityCache,
        login: OidcLoginTool,
        web_client_id: str,
    ) -> None:
        self._introspection = introspection
        self._cache = cache
        self._login = login
        self._web_client_id = web_client_id

    def execute(self, subject: str, token: str | None = None) -> str:
        """Revoke the token, forget its cached identity and return the end-session URL.

        Without a token, as behind a gateway that strips credentials, everything
        cached for the subject is forgotten instead.
        """
        if token is None:
            self._cache.flush_subject(subject)
        else:
            token_hash = hash_token(token)

            try:
                self._revoke(token, token_hash)
            finally:
                self._cache.delete_token(token_hash)

        return self._login.end_session_url()

    def _revoke(self, token: str, token_hash: str) -> None:
        """Revoke at the provider using the credentials of the issuing client.

        The provider revokes a token only for the client it was issued to, so
        browser tokens go through the web application and any other token, such
        as a machine-user one, through the introspection tool, which tolerates
        the provider refusing it with 400.
        """
        identity = self._cache.get_token(token_hash) or self._introspection.introspect(
            token
        )

        if identity is not None and identity.client_id == self._web_client_id:
            self._login.revoke(token)
        else:
            self._introspection.revoke(token)
