from pathlib import Path

import pytest
import yaml
from fastapi import FastAPI, Response, WebSocket
from fastapi.testclient import TestClient

from api.http.cache import CachePolicyMiddleware, cache_policy
from api.http.openapi import build_openapi, render_openapi

OPENAPI_FILE = Path(__file__).resolve().parents[3] / "openapi.yaml"
NODES = "/api/v2/schemas/{identifier}/revisions/{revision}/nodes/{node_id}"


def server() -> FastAPI:
    application = FastAPI()
    application.add_middleware(CachePolicyMiddleware)

    @application.get("/immutable/{item}", openapi_extra=cache_policy("immutable"))
    def immutable(item: str):
        return {"item": item}

    @application.get("/ttl", openapi_extra=cache_policy("ttl", ttl=60))
    def ttl():
        return {}

    @application.get("/revalidate", openapi_extra=cache_policy("revalidate"))
    def revalidate():
        return {}

    @application.get("/bypass", openapi_extra=cache_policy("bypass"))
    def bypass():
        return {}

    @application.get("/plain")
    def plain():
        return {}

    @application.get(
        "/tagged/{identifier}/{rest:path}",
        openapi_extra=cache_policy(
            "revalidate", tags=["schema:{identifier}", "schemas"]
        ),
    )
    def tagged(identifier: str, rest: str):
        return {}

    @application.get("/own", openapi_extra=cache_policy("immutable"))
    def own(response: Response):
        response.headers["Cache-Control"] = "private, max-age=5"

    @application.get("/missing", openapi_extra=cache_policy("immutable"))
    def missing():
        return Response(status_code=404)

    @application.post("/write", openapi_extra=cache_policy("bypass", invalidates=["a"]))
    def write():
        return {}

    @application.websocket("/socket")
    async def socket(connection: WebSocket):
        await connection.accept()
        await connection.send_json({"ok": True})
        await connection.close()

    return application


def test_policy_shape_omits_empty_fields():
    assert cache_policy("bypass") == {"x-cache": {"mode": "bypass"}}
    assert cache_policy("ttl", ttl=5, tags=["a"], invalidates=["b"]) == {
        "x-cache": {"mode": "ttl", "ttl": 5, "tags": ["a"], "invalidates": ["b"]}
    }
    assert cache_policy("immutable", ttl=5) == {"x-cache": {"mode": "immutable"}}


def test_policy_rejects_invalid_arguments():
    with pytest.raises(ValueError):
        cache_policy("forever")

    with pytest.raises(ValueError):
        cache_policy("ttl")


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        ("/immutable/1", "public, max-age=31536000, immutable"),
        ("/ttl", "public, max-age=60"),
        ("/revalidate", "no-cache"),
        ("/bypass", "no-store"),
        ("/plain", "no-store"),
    ],
)
def test_cache_control_follows_mode(path: str, expected: str):
    response = TestClient(server()).get(path)

    assert response.headers["cache-control"] == expected


def test_surrogate_key_substitutes_path_params():
    response = TestClient(server()).get("/tagged/abc/x/y")

    assert response.headers["surrogate-key"] == "schema:abc schemas"


def test_surrogate_key_is_absent_without_tags():
    assert "surrogate-key" not in TestClient(server()).get("/ttl").headers


def test_endpoint_cache_control_is_kept():
    response = TestClient(server()).get("/own")

    assert response.headers["cache-control"] == "private, max-age=5"


def test_error_responses_are_not_cached():
    response = TestClient(server()).get("/missing")

    assert response.headers["cache-control"] == "no-store"


def test_unsafe_methods_are_left_untouched():
    response = TestClient(server()).post("/write")

    assert "cache-control" not in response.headers


def test_websocket_is_untouched():
    with TestClient(server()).websocket_connect("/socket") as connection:
        assert connection.receive_json() == {"ok": True}


def test_openapi_exposes_cache_policy_with_path_params():
    document = build_openapi()
    operation = document["paths"][NODES]["get"]

    assert document["info"]["title"] == "Schema Workspace API"
    assert operation["x-cache"] == {
        "mode": "immutable",
        "tags": ["schema:{identifier}"],
        "pathParams": ["node_id"],
    }


def test_openapi_records_invalidations():
    document = build_openapi()
    operation = document["paths"]["/api/v2/schemas"]["post"]

    assert operation["x-cache"] == {"mode": "bypass", "invalidates": ["schemas"]}


def test_committed_openapi_is_up_to_date():
    assert yaml.safe_load(OPENAPI_FILE.read_text()) == yaml.safe_load(render_openapi())
    assert OPENAPI_FILE.read_text() == render_openapi()
