import pytest
from support import FakeIdentityCache, FakeTokenIntrospection

from app.ports.tools.oidc_login import TokenGrant
from app.ports.tools.token_introspection import TokenIntrospectionError
from app.use_cases.authenticate_token import AuthenticateToken, hash_token
from app.use_cases.logout import Logout
from core.entities import Identity

TOKEN = "opaque-token"
END_SESSION = "http://auth.localhost/end"
WEB = "web-id"


class Login:
    def authorization_url(self, state, code_challenge):
        return ""

    def exchange_code(self, code, code_verifier):
        return TokenGrant("", 0)

    def __init__(self):
        self.revoked = []

    def revoke(self, token):
        self.revoked.append(token)

    def end_session_url(self):
        return END_SESSION


def build():
    introspection = FakeTokenIntrospection(
        {TOKEN: Identity("alice", frozenset(), 99_999_999_999)}
    )
    cache = FakeIdentityCache()
    AuthenticateToken(introspection, cache, 300).execute(TOKEN)

    return introspection, cache


def test_logout_revokes_forgets_and_returns_end_session_url():
    introspection, cache = build()
    url = Logout(introspection, cache, Login(), WEB).execute("alice", TOKEN)

    assert url == END_SESSION
    assert introspection.revoked == [TOKEN]
    assert hash_token(TOKEN) not in cache.tokens


def test_browser_token_is_revoked_with_the_web_client():
    introspection = FakeTokenIntrospection(
        {TOKEN: Identity("alice", frozenset(), 99_999_999_999, client_id=WEB)}
    )
    cache = FakeIdentityCache()
    login = Login()
    AuthenticateToken(introspection, cache, 300).execute(TOKEN)

    Logout(introspection, cache, login, WEB).execute("alice", TOKEN)

    assert login.revoked == [TOKEN]
    assert introspection.revoked == []
    assert hash_token(TOKEN) not in cache.tokens


def test_other_client_token_is_revoked_with_the_introspection_client():
    introspection = FakeTokenIntrospection(
        {TOKEN: Identity("bot", frozenset(), 99_999_999_999, client_id="api-id")}
    )
    cache = FakeIdentityCache()
    login = Login()

    Logout(introspection, cache, login, WEB).execute("bot", TOKEN)

    assert introspection.revoked == [TOKEN]
    assert login.revoked == []


def test_cache_is_cleared_before_returning_even_when_revocation_fails():
    introspection, cache = build()

    def failing(token):
        raise TokenIntrospectionError("idp down")

    introspection.revoke = failing

    with pytest.raises(TokenIntrospectionError):
        Logout(introspection, cache, Login(), WEB).execute("alice", TOKEN)

    assert cache.tokens == {}


def test_logout_without_a_token_flushes_the_subject():
    introspection, cache = build()
    url = Logout(introspection, cache, Login(), WEB).execute("alice")

    assert url == END_SESSION
    assert introspection.revoked == []
    assert cache.tokens == {}


def test_logout_concurrent_with_authentication_does_not_cache_the_token():
    introspection = FakeTokenIntrospection(
        {TOKEN: Identity("alice", frozenset(), 99_999_999_999)}
    )
    cache = FakeIdentityCache()
    logout = Logout(introspection, cache, Login(), WEB)

    def concurrent_logout() -> None:
        introspection.after_introspect = None
        logout.execute("alice", TOKEN)

    introspection.after_introspect = concurrent_logout

    assert AuthenticateToken(introspection, cache, 300).execute(TOKEN) is not None
    assert cache.tokens == {}
    assert hash_token(TOKEN) in cache.dead


def test_token_stays_refused_after_logout_even_when_the_provider_keeps_it_active():
    introspection, cache = build()
    authenticate = AuthenticateToken(introspection, cache, 300)

    Logout(introspection, cache, Login(), WEB).execute("alice", TOKEN)

    assert authenticate.execute(TOKEN) is None
