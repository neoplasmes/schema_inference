import re
from collections.abc import Iterable
from typing import Any

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

CACHE_MODES = ("immutable", "ttl", "revalidate", "bypass")
IMMUTABLE_MAX_AGE = 31536000
SAFE_METHODS = ("GET", "HEAD")
PLACEHOLDER = re.compile(r"\{([^{}:]+)(?::[^{}]*)?\}")


def cache_policy(
    mode: str,
    ttl: int | None = None,
    tags: Iterable[str] = (),
    invalidates: Iterable[str] = (),
) -> dict[str, Any]:
    """Describe the caching contract of an operation for ``openapi_extra``.

    The result carries a single ``x-cache`` object: ``mode`` is one of
    ``immutable``, ``ttl``, ``revalidate`` or ``bypass``; ``ttl`` is present
    only for ``ttl``; ``tags`` and ``invalidates`` are omitted when empty.
    """
    if mode not in CACHE_MODES:
        raise ValueError(f"unknown cache mode: {mode}")

    policy: dict[str, Any] = {"mode": mode}

    if mode == "ttl":
        if ttl is None:
            raise ValueError("ttl mode requires ttl seconds")

        policy["ttl"] = ttl

    tag_list = list(tags)
    invalidated = list(invalidates)

    if tag_list:
        policy["tags"] = tag_list

    if invalidated:
        policy["invalidates"] = invalidated

    return {"x-cache": policy}


def cache_control(policy: dict[str, Any] | None) -> str:
    """Return the Cache-Control value that realises a policy."""
    if not policy:
        return "no-store"

    mode = policy["mode"]

    if mode == "immutable":
        return f"public, max-age={IMMUTABLE_MAX_AGE}, immutable"

    if mode == "ttl":
        return f"public, max-age={policy['ttl']}"

    if mode == "revalidate":
        return "no-cache"

    return "no-store"


def surrogate_keys(policy: dict[str, Any] | None, path_params: dict[str, Any]) -> str:
    """Render policy tags into a space-separated key list using path params."""
    if not policy:
        return ""

    def substitute(match: re.Match[str]) -> str:
        return str(path_params.get(match.group(1), match.group(0)))

    return " ".join(PLACEHOLDER.sub(substitute, tag) for tag in policy.get("tags", ()))


class CachePolicyMiddleware:
    """Pure ASGI middleware applying the matched route's ``x-cache`` policy."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)

            return

        async def send_with_policy(message: Message) -> None:
            if message["type"] == "http.response.start":
                self.apply(scope, message["status"], MutableHeaders(scope=message))

            await send(message)

        await self.app(scope, receive, send_with_policy)

    def apply(self, scope: Scope, status: int, headers: MutableHeaders) -> None:
        """Set caching headers for the response of the matched route.

        Error responses are never cached, whatever the route policy says.
        """
        route = scope.get("route")
        extra = getattr(route, "openapi_extra", None) or {}
        policy = extra.get("x-cache") if status < 400 else None

        if "cache-control" not in headers and scope["method"] in SAFE_METHODS:
            headers["Cache-Control"] = cache_control(policy)

        keys = surrogate_keys(policy, scope.get("path_params", {}))

        if keys and "surrogate-key" not in headers:
            headers["Surrogate-Key"] = keys
