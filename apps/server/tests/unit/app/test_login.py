import base64
import hashlib
import json
from urllib.parse import parse_qs, urlsplit

import pytest

from app.ports.tools.oidc_login import OidcLoginError, TokenGrant
from app.use_cases.complete_login import CompleteLogin, CompleteLoginError
from app.use_cases.start_login import StartLogin, safe_return_to


class Login:
    def __init__(self):
        self.exchanged = []

    def authorization_url(self, state, code_challenge):
        return f"http://idp/authorize?state={state}&challenge={code_challenge}"

    def exchange_code(self, code, code_verifier):
        self.exchanged.append((code, code_verifier))

        if code == "bad":
            raise OidcLoginError("rejected")

        return TokenGrant("access", 120)

    def revoke(self, token):
        return None

    def end_session_url(self):
        return "http://idp/end"


@pytest.mark.parametrize(
    "value",
    ["/", "/app", "/a/b?x=1#y", "/schemas/1"],
)
def test_relative_paths_are_kept(value):
    assert safe_return_to(value) == value


@pytest.mark.parametrize(
    "value",
    [
        None,
        "",
        "app",
        "//evil.example",
        "///evil.example",
        "http://evil.example",
        "https://evil.example/x",
        "/\\evil.example",
        "/ok\r\nSet-Cookie: x=1",
        "javascript:alert(1)",
    ],
)
def test_anything_else_falls_back_to_root(value):
    assert safe_return_to(value) == "/"


def test_start_login_uses_state_and_a_matching_pkce_challenge():
    redirect = StartLogin(Login()).execute("/schemas")
    query = parse_qs(urlsplit(redirect.url).query)
    flow = json.loads(base64.urlsafe_b64decode(redirect.flow))
    expected = (
        base64.urlsafe_b64encode(hashlib.sha256(flow["verifier"].encode()).digest())
        .rstrip(b"=")
        .decode()
    )

    assert query["state"] == [flow["state"]]
    assert query["challenge"] == [expected]
    assert flow["returnTo"] == "/schemas"


def test_complete_login_exchanges_code_with_the_stored_verifier():
    login = Login()
    redirect = StartLogin(login).execute("//evil.example")
    flow = json.loads(base64.urlsafe_b64decode(redirect.flow))
    result = CompleteLogin(login).execute("code-1", flow["state"], redirect.flow)

    assert login.exchanged == [("code-1", flow["verifier"])]
    assert (result.access_token, result.expires_in, result.return_to) == (
        "access",
        120,
        "/",
    )


def test_complete_login_rejects_foreign_state_missing_flow_and_garbage():
    login = Login()
    redirect = StartLogin(login).execute(None)
    use_case = CompleteLogin(login)

    for state, flow in (("wrong", redirect.flow), ("x", None), ("x", "!!!")):
        with pytest.raises(CompleteLoginError):
            use_case.execute("code", state, flow)

    assert login.exchanged == []


def test_exchange_failure_propagates():
    login = Login()
    redirect = StartLogin(login).execute(None)
    state = json.loads(base64.urlsafe_b64decode(redirect.flow))["state"]

    with pytest.raises(OidcLoginError):
        CompleteLogin(login).execute("bad", state, redirect.flow)
