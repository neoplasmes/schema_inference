import json
from collections.abc import Iterator
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Thread
from unittest.mock import Mock

import pytest

from app.ports.tools.cache_invalidation import CacheInvalidationError
from core.entities import ResourceChange
from env.tools.cache_invalidation import (
    CompositeCacheInvalidationTool,
    NullCacheInvalidationTool,
    SouinCacheInvalidationTool,
)


@contextmanager
def souin(status: int = 204) -> Iterator[tuple[str, list[dict]]]:
    received: list[dict] = []

    class Handler(BaseHTTPRequestHandler):
        def handle_request(self):
            length = int(self.headers.get("Content-Length", 0))
            received.append(
                {
                    "method": self.command,
                    "headers": {
                        key.lower(): value for key, value in self.headers.items()
                    },
                    "body": self.rfile.read(length),
                }
            )
            self.send_response(status)
            self.send_header("Content-Length", "0")
            self.end_headers()

        do_PURGE = do_POST = handle_request

        def log_message(self, *arguments):
            return None

    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()

    try:
        yield f"http://127.0.0.1:{server.server_port}/souin-api/souin", received
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def test_purges_collection_and_resource_keys_with_basic_auth():
    with souin() as (url, received):
        SouinCacheInvalidationTool(url, "purger", "secret").invalidate(
            [ResourceChange("schema", "s1"), ResourceChange("analysis", "a1")]
        )

    assert len(received) == 1
    assert received[0]["method"] == "PURGE"
    assert (
        received[0]["headers"]["surrogate-key"]
        == "schemas, schema:s1, analyses, analysis:a1"
    )
    assert received[0]["headers"]["authorization"] == "Basic cHVyZ2VyOnNlY3JldA=="


def test_deletion_adds_a_uri_prefix_purge():
    with souin() as (url, received):
        SouinCacheInvalidationTool(url).invalidate(
            [ResourceChange("schema", "s1", True)]
        )

    assert [item["method"] for item in received] == ["PURGE", "POST"]
    assert "authorization" not in received[0]["headers"]
    assert received[1]["headers"]["content-type"] == "application/json"
    assert json.loads(received[1]["body"]) == {
        "type": "uri-prefix",
        "selectors": ["/api/v2/schemas/s1/"],
        "purge": True,
    }


def test_unknown_kinds_are_ignored():
    with souin() as (url, received):
        SouinCacheInvalidationTool(url).invalidate([ResourceChange("other", "x", True)])

    assert received == []


def test_http_errors_are_reported_as_invalidation_errors():
    with souin(status=500) as (url, _):
        with pytest.raises(CacheInvalidationError, match="PURGE"):
            SouinCacheInvalidationTool(url).invalidate([ResourceChange("schema", "s1")])


def test_unreachable_cache_is_reported_as_invalidation_error():
    tool = SouinCacheInvalidationTool("http://127.0.0.1:1/souin", timeout=1)

    with pytest.raises(CacheInvalidationError):
        tool.invalidate([ResourceChange("schema", "s1")])


def test_composite_tries_every_listener_before_failing():
    failing, working = Mock(), Mock()
    failing.invalidate.side_effect = CacheInvalidationError("first")
    changes = [ResourceChange("schema", "s1")]

    with pytest.raises(CacheInvalidationError, match="first"):
        CompositeCacheInvalidationTool([failing, working]).invalidate(changes)

    working.invalidate.assert_called_once_with(changes)


def test_null_tool_accepts_everything():
    NullCacheInvalidationTool().invalidate([ResourceChange("schema", "s1")])
