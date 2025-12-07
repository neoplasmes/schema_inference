import time

from fastapi.testclient import TestClient
from support import FakeIdentityCache, FakeTokenIntrospection

from core.entities import Identity
from main import create_app

from .test_workspace import settings

FUTURE = int(time.time()) + 3600
ORIGIN = "http://localhost:3000"


def application(tmp_path, database_url, cache: FakeIdentityCache):
    configuration = settings(tmp_path, database_url)
    introspection = FakeTokenIntrospection(
        {
            "alice-token": Identity("alice", frozenset({"editor"}), FUTURE),
            "bob-token": Identity("bob", frozenset({"editor"}), FUTURE),
        }
    )
    configuration = type(configuration)(
        **{**configuration.__dict__, "auth_trust_gateway": False}
    )

    return create_app(
        settings=configuration, identity_cache=cache, token_introspection=introspection
    )


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def body(content: str = '{"price":1}'):
    return {
        "title": "Products",
        "documents": [
            {
                "name": "a.json",
                "format": "json",
                "size": len(content),
                "content": content,
            }
        ],
    }


def test_requests_authenticate_through_the_token_use_case(tmp_path, database_url):
    cache = FakeIdentityCache()

    with TestClient(application(tmp_path, database_url, cache)) as client:
        assert client.get("/api/v2/schemas").status_code == 401

        created = client.post(
            "/api/v2/analyses",
            json=body(),
            headers={**bearer("alice-token"), "Idempotency-Key": "k1"},
        )

        assert created.status_code == 202
        path = created.headers["location"]
        assert client.get(path, headers=bearer("alice-token")).status_code == 200
        assert client.get(path, headers=bearer("bob-token")).status_code == 404
        assert client.get(path, headers=bearer("unknown")).status_code == 401


def test_cookie_session_requires_an_allowed_origin_for_writes(tmp_path, database_url):
    cache = FakeIdentityCache()

    with TestClient(application(tmp_path, database_url, cache)) as client:
        client.cookies.set("session", "alice-token")
        headers = {"Idempotency-Key": "k1"}

        assert client.get("/api/v2/session").json()["sub"] == "alice"
        assert (
            client.post("/api/v2/analyses", json=body(), headers=headers).status_code
            == 403
        )
        assert (
            client.post(
                "/api/v2/analyses", json=body(), headers={**headers, "Origin": ORIGIN}
            ).status_code
            == 202
        )


def test_gateway_check_caches_owner_and_deletion_invalidates_it(tmp_path, database_url):
    cache = FakeIdentityCache()

    with TestClient(application(tmp_path, database_url, cache)) as client:
        created = client.post(
            "/api/v2/analyses",
            json=body(),
            headers={**bearer("alice-token"), "Idempotency-Key": "k1"},
        )
        path = created.headers["location"]
        identifier = path.rsplit("/", 1)[1]
        probe = {
            **bearer("alice-token"),
            "X-Forwarded-Method": "GET",
            "X-Forwarded-Uri": path,
        }
        deadline = time.monotonic() + 30

        while client.get(path, headers=bearer("alice-token")).json()["status"] not in (
            "completed",
            "failed",
        ):
            assert time.monotonic() < deadline
            time.sleep(0.02)

        assert client.get("/api/v2/auth/check", headers=probe).status_code == 204
        assert cache.owners[("analysis", identifier)] == "alice"
        assert (
            client.get(
                "/api/v2/auth/check", headers={**probe, **bearer("bob-token")}
            ).status_code
            == 404
        )

        removed = client.delete(path, headers=bearer("alice-token"))

        assert removed.status_code == 204

        deadline = time.monotonic() + 15

        while ("analysis", identifier) in cache.owners:
            assert time.monotonic() < deadline
            time.sleep(0.02)

        assert client.get("/api/v2/auth/check", headers=probe).status_code == 404
