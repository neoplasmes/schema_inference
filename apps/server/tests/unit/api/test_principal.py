import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from support import FakeIdentityCache, FakeTokenIntrospection

from api.http.principal import (
    AccessError,
    Actor,
    Authentication,
    bearer_token,
    resolve_principal,
)
from app.use_cases.authenticate_token import AuthenticateToken
from core.entities import Identity, Principal

ORIGIN = "http://localhost:3000"
FOREIGN = "http://evil.example"


def authentication(trust_gateway: bool = False) -> Authentication:
    introspection = FakeTokenIntrospection(
        {
            "alice-token": Identity("alice", frozenset({"editor"}), 10**12),
            "root-token": Identity("root", frozenset({"admin"}), 10**12),
        }
    )

    return Authentication(
        AuthenticateToken(introspection, FakeIdentityCache(), 300),
        trust_gateway,
        (ORIGIN,),
    )


def resolve(headers=None, cookies=None, method="GET", trust=False, **extra):
    return resolve_principal(
        authentication(trust), headers or {}, cookies or {}, method, trust, **extra
    )


def refused(**arguments) -> AccessError:
    with pytest.raises(AccessError) as caught:
        resolve(**arguments)

    return caught.value


def test_only_the_admin_role_grants_admin():
    assert not Principal("u", frozenset({"editor"})).is_admin
    assert Principal("u", frozenset({"editor", "admin"})).is_admin
    assert not Principal("u").is_admin


def test_bearer_scheme_is_case_insensitive_and_required():
    assert bearer_token({"authorization": "Bearer abc"}) == "abc"
    assert bearer_token({"authorization": "bearer abc"}) == "abc"
    assert bearer_token({"authorization": "Basic abc"}) is None
    assert bearer_token({"authorization": "Bearer "}) is None
    assert bearer_token({}) is None


def test_bearer_token_authenticates():
    principal = resolve({"authorization": "Bearer alice-token"})

    assert principal == Principal("alice", frozenset({"editor"}))


def test_cookie_authenticates_safe_requests_without_origin():
    assert resolve(cookies={"session": "alice-token"}).subject == "alice"


def test_missing_and_inactive_tokens_are_unauthenticated():
    for arguments in (
        {},
        {"headers": {"authorization": "Bearer nope"}},
        {"cookies": {"session": "nope"}},
    ):
        error = refused(**arguments)

        assert (error.status, error.code) == (401, "unauthenticated")


@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
def test_cookie_with_unsafe_method_needs_an_allowed_origin(method):
    cookies = {"session": "alice-token"}

    assert resolve({"origin": ORIGIN}, cookies, method).subject == "alice"

    for headers in ({}, {"origin": FOREIGN}):
        error = refused(headers=headers, cookies=cookies, method=method)

        assert (error.status, error.code) == (403, "forbidden_origin")


def test_bearer_with_unsafe_method_needs_no_origin():
    headers = {"authorization": "Bearer alice-token"}

    assert resolve(headers, method="POST").subject == "alice"


def test_websocket_style_checks_origin_even_for_get():
    cookies = {"session": "alice-token"}

    assert refused(cookies=cookies, require_origin=True).status == 403
    assert resolve({"origin": ORIGIN}, cookies, require_origin=True).subject == "alice"


def test_gateway_headers_are_trusted_only_when_enabled():
    headers = {"x-user-id": "mallory", "x-user-roles": "admin, editor"}

    assert resolve(headers, trust=True) == Principal(
        "mallory", frozenset({"admin", "editor"})
    )
    assert refused(headers=headers).status == 401


def test_trusted_gateway_headers_skip_csrf_but_token_fallback_does_not():
    headers = {"x-user-id": "alice"}

    assert resolve(headers, method="POST", trust=True).subject == "alice"

    error = refused(cookies={"session": "alice-token"}, method="POST", trust=True)

    assert error.status == 403


def test_dependency_is_wired_through_application_state():
    server = FastAPI()
    server.state.authentication = authentication()

    @server.get("/who")
    def who(principal: Actor):
        return {"sub": principal.subject}

    @server.exception_handler(AccessError)
    async def handler(request, error):
        from fastapi.responses import JSONResponse

        return JSONResponse({"code": error.code}, status_code=error.status)

    client = TestClient(server)

    assert client.get(
        "/who", headers={"Authorization": "Bearer alice-token"}
    ).json() == {"sub": "alice"}
    assert client.get("/who").status_code == 401
