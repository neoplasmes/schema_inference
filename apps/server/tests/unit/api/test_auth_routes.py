import base64
import hashlib
import hmac
import json
import time
from typing import cast
from unittest.mock import MagicMock
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from support import FakeIdentityCache, FakeTokenIntrospection

from api.http import create_http_server
from api.http.auth import create_auth_router
from api.http.identity import create_identity_router
from api.http.principal import Authentication
from app.ports.tools.oidc_login import OidcLoginError, TokenGrant
from app.ports.uow.workspace import WorkspaceUow
from app.use_cases.apply_identity_event import ApplyIdentityEvent
from app.use_cases.authenticate_token import AuthenticateToken, hash_token
from app.use_cases.authorize_request import AuthorizeRequest
from app.use_cases.complete_login import CompleteLogin
from app.use_cases.logout import Logout
from app.use_cases.start_login import StartLogin
from core.entities import Identity

ORIGIN = "http://localhost:3000"
KEY = "webhook-key"
FUTURE = 10**12
WEB = "web-id"


class Login:
    def authorization_url(self, state, code_challenge):
        return f"http://idp.example/authorize?state={state}&c={code_challenge}"

    def exchange_code(self, code, code_verifier):
        if code == "bad":
            raise OidcLoginError("no")

        return TokenGrant("alice-token", 60)

    def revoke(self, token):
        return None

    def end_session_url(self):
        return "http://idp.example/end"


class Repository:
    owners = {("schema", "s1"): "alice", ("analysis", "a1"): "alice"}

    def owner(self, kind, identifier):
        return self.owners.get((kind, identifier))


class Store:
    def read(self):
        context = MagicMock()
        context.__enter__.return_value = Repository()

        return context


class Stack:
    def __init__(self):
        self.cache = FakeIdentityCache()
        self.introspection = FakeTokenIntrospection(
            {
                "alice-token": Identity("alice", frozenset({"editor"}), FUTURE),
                "bob-token": Identity("bob", frozenset({"editor"}), FUTURE),
                "root-token": Identity("root", frozenset({"admin", "editor"}), FUTURE),
            }
        )
        login = Login()
        authentication = Authentication(
            AuthenticateToken(self.introspection, self.cache, 300), False, (ORIGIN,)
        )
        server = create_http_server(
            upload_documents=MagicMock(),
            process_documents=MagicMock(),
            generate_schema=MagicMock(),
            cleanup_session=MagicMock(),
            cleanup_job=MagicMock(),
            allowed_origins=(ORIGIN,),
            authentication=authentication,
        )
        server.include_router(
            create_auth_router(
                StartLogin(login),
                CompleteLogin(login),
                Logout(self.introspection, self.cache, login, WEB),
                AuthorizeRequest(cast(WorkspaceUow, Store()), self.cache),
                False,
            )
        )
        server.include_router(
            create_identity_router(ApplyIdentityEvent(self.cache), KEY)
        )
        self.server: FastAPI = server
        self.client = TestClient(server, follow_redirects=False)


@pytest.fixture
def stack():
    return Stack()


def check(stack, token, uri, method="GET", **headers):
    return stack.client.get(
        "/api/v2/auth/check",
        headers={
            "Authorization": f"Bearer {token}",
            "X-Forwarded-Method": method,
            "X-Forwarded-Uri": uri,
            **headers,
        },
    )


def test_check_allows_owner_with_identity_headers(stack):
    response = check(stack, "alice-token", "/api/v2/schemas/s1/revisions/s1/manifest")

    assert response.status_code == 204
    assert response.headers["x-user-id"] == "alice"
    assert response.headers["x-user-roles"] == "editor"
    assert response.headers["cache-control"] == "no-store"


def test_check_is_not_found_for_others_and_missing_resources(stack):
    for uri in ("/api/v2/schemas/s1", "/api/v2/analyses/none"):
        response = check(stack, "bob-token", uri)

        assert response.status_code == 404
        assert response.json() == {"code": "not_found"}


def test_check_lets_admin_through_and_ignores_collections(stack):
    assert check(stack, "root-token", "/api/v2/schemas/s1").status_code == 204
    assert check(stack, "bob-token", "/api/v2/schemas").status_code == 204


def test_check_without_or_with_unknown_token_is_401(stack):
    anonymous = stack.client.get(
        "/api/v2/auth/check", headers={"X-Forwarded-Uri": "/api/v2/schemas"}
    )
    unknown = check(stack, "nope", "/api/v2/schemas")

    for response in (anonymous, unknown):
        assert response.status_code == 401
        assert response.json() == {"code": "unauthenticated"}


def test_check_does_not_trust_forwarded_identity_headers(stack):
    response = stack.client.get(
        "/api/v2/auth/check",
        headers={"X-User-Id": "root", "X-User-Roles": "admin"},
    )

    assert response.status_code == 401


def test_check_applies_csrf_to_forwarded_unsafe_methods_with_cookie(stack):
    stack.client.cookies.set("session", "alice-token")
    headers = {"X-Forwarded-Method": "DELETE", "X-Forwarded-Uri": "/api/v2/schemas/s1"}

    assert stack.client.get("/api/v2/auth/check", headers=headers).status_code == 403
    assert (
        stack.client.get(
            "/api/v2/auth/check", headers={**headers, "Origin": ORIGIN}
        ).status_code
        == 204
    )


def test_login_redirects_with_flow_cookie_and_sanitised_return_path(stack):
    response = stack.client.get("/auth/login", params={"returnTo": "//evil.example"})
    flow = json.loads(base64.urlsafe_b64decode(response.cookies["auth_flow"]))
    query = parse_qs(urlsplit(response.headers["location"]).query)

    assert response.status_code == 302
    assert query["state"] == [flow["state"]]
    assert flow["returnTo"] == "/"
    assert "httponly" in response.headers["set-cookie"].lower()


def test_callback_sets_session_cookie_and_redirects_to_relative_path(stack):
    login = stack.client.get("/auth/login", params={"returnTo": "/schemas"})
    state = parse_qs(urlsplit(login.headers["location"]).query)["state"][0]
    response = stack.client.get("/auth/callback", params={"code": "c", "state": state})
    cookie = next(
        value
        for value in response.headers.get_list("set-cookie")
        if value.startswith("session=")
    )

    assert response.status_code == 302
    assert response.headers["location"] == "/schemas"
    assert "HttpOnly" in cookie
    assert "SameSite=lax" in cookie
    assert "Max-Age=60" in cookie
    assert "Path=/" in cookie


def test_callback_rejects_wrong_state_error_and_failed_exchange(stack):
    login = stack.client.get("/auth/login")
    state = parse_qs(urlsplit(login.headers["location"]).query)["state"][0]

    assert (
        stack.client.get(
            "/auth/callback", params={"code": "c", "state": "x"}
        ).status_code
        == 400
    )
    assert (
        stack.client.get("/auth/callback", params={"error": "denied"}).status_code
        == 400
    )
    assert (
        stack.client.get(
            "/auth/callback", params={"code": "bad", "state": state}
        ).status_code
        == 502
    )


def test_session_reports_subject_and_roles(stack):
    response = stack.client.get(
        "/api/v2/session", headers={"Authorization": "Bearer root-token"}
    )

    assert response.json() == {"sub": "root", "roles": ["admin", "editor"]}
    assert stack.client.get("/api/v2/session").status_code == 401


def test_logout_revokes_clears_cache_and_cookie_before_responding(stack):
    stack.client.cookies.set("session", "alice-token")
    headers = {"Origin": ORIGIN}
    assert stack.client.get("/api/v2/session").status_code == 200
    assert hash_token("alice-token") in stack.cache.tokens

    response = stack.client.delete("/api/v2/session", headers=headers)

    assert response.status_code == 200
    assert response.json() == {"endSessionUrl": "http://idp.example/end"}
    assert stack.introspection.revoked == ["alice-token"]
    assert stack.cache.tokens == {}
    assert (
        'session=""' in response.headers["set-cookie"]
        or "Max-Age=0" in response.headers["set-cookie"]
    )


def test_logout_with_cookie_requires_origin(stack):
    stack.client.cookies.set("session", "alice-token")

    assert stack.client.delete("/api/v2/session").status_code == 403
    assert stack.introspection.revoked == []


def sign(body: bytes, timestamp: int | None = None, key: str = KEY) -> dict[str, str]:
    stamp = int(time.time()) if timestamp is None else timestamp
    digest = hmac.new(
        key.encode(), f"{stamp}.".encode() + body, hashlib.sha256
    ).hexdigest()

    return {"ZITADEL-Signature": f"t={stamp},v1={digest}"}


def test_webhook_applies_signed_events(stack):
    stack.cache.put_token("h", Identity("alice", frozenset(), FUTURE), 300, 0)
    body = json.dumps({"event_type": "user.locked", "aggregateID": "alice"}).encode()
    response = stack.client.post(
        "/internal/identity/events", content=body, headers=sign(body)
    )

    assert response.status_code == 204
    assert stack.cache.tokens == {}


def test_webhook_rejects_bad_expired_and_missing_signatures(stack):
    stack.cache.put_token("h", Identity("alice", frozenset(), FUTURE), 300, 0)
    body = json.dumps({"event_type": "user.locked", "aggregateID": "alice"}).encode()
    attempts = [
        {},
        sign(body, key="other"),
        sign(body, timestamp=int(time.time()) - 3600),
        sign(body + b" "),
    ]

    for headers in attempts:
        response = stack.client.post(
            "/internal/identity/events", content=body, headers=headers
        )

        assert response.status_code == 401

    assert "h" in stack.cache.tokens


def test_webhook_rejects_non_object_bodies_and_is_hidden_from_openapi(stack):
    body = b"[1]"

    assert (
        stack.client.post(
            "/internal/identity/events", content=body, headers=sign(body)
        ).status_code
        == 400
    )
    assert "/internal/identity/events" not in stack.server.openapi()["paths"]


def test_legacy_schema_routes_require_authentication(stack):
    assert stack.client.post("/schema/sessions").status_code == 401
    assert stack.client.post("/schema/xsd", json={}).status_code == 401
