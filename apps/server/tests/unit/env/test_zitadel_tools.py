import base64
import json
from collections.abc import Iterator
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Thread
from urllib.parse import parse_qs, urlsplit

import pytest
from support import FakeIdentityCache

from app.ports.tools.cache_invalidation import CacheInvalidationError
from app.ports.tools.identity_cache import IdentityCacheError
from app.ports.tools.oidc_login import OidcLoginError
from app.ports.tools.token_introspection import TokenIntrospectionError
from core.entities import ResourceChange
from env.tools.cache_invalidation import AclCacheInvalidationTool
from env.tools.oidc_login import ZitadelOidcLoginTool
from env.tools.token_introspection import ZitadelTokenIntrospectionTool

ISSUER = "http://auth.localhost:8080"


@contextmanager
def idp(answers: dict[str, tuple[int, dict]]) -> Iterator[tuple[str, list[dict]]]:
    received: list[dict] = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            length = int(self.headers.get("Content-Length", 0))
            received.append(
                {
                    "path": self.path,
                    "host": self.headers.get("Host"),
                    "authorization": self.headers.get("Authorization"),
                    "form": parse_qs(self.rfile.read(length).decode()),
                }
            )
            status, body = answers.get(self.path, (404, {}))
            payload = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *arguments):
            return None

    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()

    try:
        yield f"http://127.0.0.1:{server.server_port}", received
    finally:
        server.shutdown()
        thread.join()
        server.server_close()


def introspection(url: str) -> ZitadelTokenIntrospectionTool:
    return ZitadelTokenIntrospectionTool(url, ISSUER, "api-id", "api:secret", "42")


def test_introspection_maps_claims_and_sends_basic_auth_and_public_host():
    answer = {
        "active": True,
        "sub": "user-1",
        "exp": 2000000000,
        "jti": "jti-1",
        "client_id": "web",
        "urn:zitadel:iam:org:project:roles": {"admin": {"o": "d"}},
        "urn:zitadel:iam:org:project:42:roles": {"editor": {"o": "d"}},
    }

    with idp({"/oauth/v2/introspect": (200, answer)}) as (url, received):
        identity = introspection(url).introspect("opaque")

    assert identity is not None
    assert identity.subject == "user-1"
    assert identity.roles == {"admin", "editor"}
    assert (identity.expires_at, identity.token_id, identity.client_id) == (
        2000000000,
        "jti-1",
        "web",
    )
    assert received[0]["host"] == "auth.localhost:8080"
    assert received[0]["form"] == {"token": ["opaque"]}
    expected = base64.b64encode(b"api-id:api%3Asecret").decode()
    assert received[0]["authorization"] == f"Basic {expected}"


def test_inactive_token_yields_none():
    with idp({"/oauth/v2/introspect": (200, {"active": False})}) as (url, _):
        assert introspection(url).introspect("opaque") is None


def test_unreachable_or_failing_provider_raises():
    with idp({"/oauth/v2/introspect": (500, {})}) as (url, _):
        with pytest.raises(TokenIntrospectionError):
            introspection(url).introspect("opaque")

    with pytest.raises(TokenIntrospectionError):
        introspection("http://127.0.0.1:1").introspect("opaque")


def test_revoke_posts_the_token():
    with idp({"/oauth/v2/revoke": (200, {})}) as (url, received):
        introspection(url).revoke("opaque")

    assert received[0]["form"] == {
        "token": ["opaque"],
        "token_type_hint": ["access_token"],
    }


def test_revoke_tolerates_a_token_of_another_client():
    answer = {"error": "invalid_client"}

    with idp({"/oauth/v2/revoke": (400, answer)}) as (url, _):
        introspection(url).revoke("opaque")


def test_revoke_still_fails_when_the_provider_is_broken():
    with idp({"/oauth/v2/revoke": (500, {})}) as (url, _):
        with pytest.raises(TokenIntrospectionError):
            introspection(url).revoke("opaque")


def login(url: str = "http://127.0.0.1:1") -> ZitadelOidcLoginTool:
    return ZitadelOidcLoginTool(
        ISSUER,
        url,
        "web-id",
        "web-secret",
        "42",
        "http://localhost:8000/auth/callback",
        "http://localhost:3000/",
    )


def test_authorization_url_carries_pkce_state_and_scopes():
    url = login().authorization_url("st", "ch")
    parts = urlsplit(url)
    query = parse_qs(parts.query)

    assert (
        f"{parts.scheme}://{parts.netloc}{parts.path}" == f"{ISSUER}/oauth/v2/authorize"
    )
    assert query["response_type"] == ["code"]
    assert query["client_id"] == ["web-id"]
    assert query["state"] == ["st"]
    assert query["code_challenge"] == ["ch"]
    assert query["code_challenge_method"] == ["S256"]
    assert query["redirect_uri"] == ["http://localhost:8000/auth/callback"]
    assert "urn:zitadel:iam:org:project:id:42:aud" in query["scope"][0].split()
    assert "urn:zitadel:iam:org:project:roles" in query["scope"][0].split()


def test_code_exchange_uses_internal_url_with_public_host():
    answer = {"access_token": "tok", "expires_in": 3600}

    with idp({"/oauth/v2/token": (200, answer)}) as (url, received):
        grant = login(url).exchange_code("code", "verifier")

    assert (grant.access_token, grant.expires_in) == ("tok", 3600)
    assert received[0]["host"] == "auth.localhost:8080"
    assert received[0]["form"]["code_verifier"] == ["verifier"]
    assert received[0]["form"]["grant_type"] == ["authorization_code"]


def test_rejected_code_exchange_raises():
    with idp({"/oauth/v2/token": (400, {"error": "invalid_grant"})}) as (url, _):
        with pytest.raises(OidcLoginError):
            login(url).exchange_code("code", "verifier")


def test_web_revoke_uses_the_web_client_credentials():
    with idp({"/oauth/v2/revoke": (200, {})}) as (url, received):
        login(url).revoke("opaque")

    assert received[0]["host"] == "auth.localhost:8080"
    assert received[0]["form"]["token"] == ["opaque"]


def test_web_revoke_failure_raises():
    with idp({"/oauth/v2/revoke": (400, {"error": "invalid_client"})}) as (url, _):
        with pytest.raises(OidcLoginError):
            login(url).revoke("opaque")


def test_end_session_url_names_client_and_return_target():
    query = parse_qs(urlsplit(login().end_session_url()).query)

    assert query["client_id"] == ["web-id"]
    assert query["post_logout_redirect_uri"] == ["http://localhost:3000/"]


def test_acl_listener_forgets_owners_of_changed_resources():
    cache = FakeIdentityCache()
    cache.put_owner("schema", "s1", "alice")
    cache.put_owner("analysis", "a1", "alice")
    AclCacheInvalidationTool(cache).invalidate(
        [ResourceChange("schema", "s1"), ResourceChange("analysis", "a1", True)]
    )

    assert cache.owners == {}


def test_acl_listener_reports_cache_failures_as_invalidation_errors():
    class Broken(FakeIdentityCache):
        def delete_owner(self, kind, identifier):
            raise IdentityCacheError("down")

    with pytest.raises(CacheInvalidationError):
        AclCacheInvalidationTool(Broken()).invalidate([ResourceChange("schema", "s1")])
