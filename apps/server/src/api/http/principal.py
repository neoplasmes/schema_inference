from collections.abc import Mapping
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Request

from app.use_cases.authenticate_token import AuthenticateToken
from core.entities import Principal

SESSION_COOKIE = "session"
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


class AccessError(Exception):
    """Refuse a request with an HTTP status and a stable machine-readable code."""

    def __init__(self, status: int, code: str) -> None:
        super().__init__(code)
        self.status = status
        self.code = code


@dataclass(frozen=True)
class Authentication:
    """Hold what request authentication needs, shared through the application state."""

    authenticate: AuthenticateToken
    trust_gateway: bool
    allowed_origins: tuple[str, ...]


def bearer_token(headers: Mapping[str, str]) -> str | None:
    """Extract the token of an ``Authorization: Bearer`` header, if any."""
    scheme, _, token = headers.get("authorization", "").partition(" ")

    return token.strip() or None if scheme.lower() == "bearer" else None


def request_token(headers: Mapping[str, str], cookies: Mapping[str, str]) -> str | None:
    """Return the bearer token, or else the session cookie."""
    return bearer_token(headers) or cookies.get(SESSION_COOKIE) or None


def forwarded_principal(headers: Mapping[str, str]) -> Principal | None:
    """Read the identity the trusted gateway has attached to the request."""
    subject = headers.get("x-user-id")

    if not subject:
        return None

    roles = frozenset(
        role.strip()
        for role in headers.get("x-user-roles", "").split(",")
        if role.strip()
    )

    return Principal(subject, roles)


def resolve_principal(
    authentication: Authentication,
    headers: Mapping[str, str],
    cookies: Mapping[str, str],
    method: str,
    trust_gateway: bool,
    require_origin: bool = False,
) -> Principal:
    """Authenticate one request or raise ``AccessError``.

    Cookie-authenticated requests that change state must come from an allowed
    origin, which stops other sites from riding on the browser's cookie.
    """
    if trust_gateway:
        forwarded = forwarded_principal(headers)

        if forwarded is not None:
            return forwarded

    bearer = bearer_token(headers)
    token = bearer or cookies.get(SESSION_COOKIE)

    if not token:
        raise AccessError(401, "unauthenticated")

    unsafe = method.upper() not in SAFE_METHODS

    if bearer is None and (unsafe or require_origin):
        if headers.get("origin") not in authentication.allowed_origins:
            raise AccessError(403, "forbidden_origin")

    principal = authentication.authenticate.execute(token)

    if principal is None:
        raise AccessError(401, "unauthenticated")

    return principal


def current_principal(request: Request) -> Principal:
    """Resolve the subject acting in the current request.

    This is the single injection point for authentication: every route takes
    its acting principal from here.
    """
    authentication: Authentication = request.app.state.authentication

    return resolve_principal(
        authentication,
        request.headers,
        request.cookies,
        request.method,
        authentication.trust_gateway,
    )


Actor = Annotated[Principal, Depends(current_principal)]
