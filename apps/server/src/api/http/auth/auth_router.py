from typing import Annotated

from fastapi import APIRouter, Header, Query, Request, Response
from fastapi.responses import JSONResponse, RedirectResponse

from api.http.cache import cache_policy
from api.http.principal import (
    SESSION_COOKIE,
    AccessError,
    Actor,
    Authentication,
    request_token,
    resolve_principal,
)
from app.ports.tools.oidc_login import OidcLoginError
from app.use_cases.authorize_request import AuthorizeRequest
from app.use_cases.complete_login import CompleteLogin, CompleteLoginError
from app.use_cases.logout import Logout
from app.use_cases.start_login import StartLogin

FLOW_COOKIE = "auth_flow"
FLOW_MAX_AGE = 600
DEFAULT_SESSION_AGE = 3600


def create_auth_router(
    start_login: StartLogin,
    complete_login: CompleteLogin,
    logout: Logout,
    authorize: AuthorizeRequest,
    cookie_secure: bool,
) -> APIRouter:
    router = APIRouter(tags=["auth"])

    @router.get(
        "/auth/login",
        status_code=302,
        response_class=RedirectResponse,
        responses={302: {"description": "Redirect to the identity provider."}},
    )
    def login(return_to: Annotated[str | None, Query(alias="returnTo")] = None):
        redirect = start_login.execute(return_to)
        response = RedirectResponse(redirect.url, status_code=302)
        response.set_cookie(
            FLOW_COOKIE,
            redirect.flow,
            max_age=FLOW_MAX_AGE,
            path="/auth",
            httponly=True,
            samesite="lax",
            secure=cookie_secure,
        )

        return response

    @router.get(
        "/auth/callback",
        status_code=302,
        response_class=RedirectResponse,
        responses={
            302: {"description": "Session established; redirect to the return path."},
            400: {"description": "The callback does not match a started login."},
        },
    )
    def callback(
        request: Request,
        code: str = "",
        state: str = "",
        error: str = "",
    ):
        if error:
            return JSONResponse({"code": "login_failed"}, status_code=400)

        try:
            result = complete_login.execute(
                code, state, request.cookies.get(FLOW_COOKIE)
            )
        except CompleteLoginError:
            return JSONResponse({"code": "invalid_login"}, status_code=400)
        except OidcLoginError:
            return JSONResponse({"code": "login_unavailable"}, status_code=502)

        response = RedirectResponse(result.return_to, status_code=302)
        response.set_cookie(
            SESSION_COOKIE,
            result.access_token,
            max_age=result.expires_in or DEFAULT_SESSION_AGE,
            path="/",
            httponly=True,
            samesite="lax",
            secure=cookie_secure,
        )
        response.delete_cookie(FLOW_COOKIE, path="/auth")

        return response

    @router.get("/api/v2/session", openapi_extra=cache_policy("bypass"))
    def get_session(principal: Actor):
        return {"sub": principal.subject, "roles": sorted(principal.roles)}

    @router.delete("/api/v2/session", openapi_extra=cache_policy("bypass"))
    def delete_session(request: Request, principal: Actor):
        url = logout.execute(
            principal.subject, request_token(request.headers, request.cookies)
        )
        response = JSONResponse({"endSessionUrl": url})
        response.delete_cookie(
            SESSION_COOKIE,
            path="/",
            httponly=True,
            samesite="lax",
            secure=cookie_secure,
        )

        return response

    @router.get(
        "/api/v2/auth/check",
        status_code=204,
        openapi_extra=cache_policy("bypass"),
        responses={
            401: {"description": "No active token."},
            404: {"description": "The target resource does not exist for the caller."},
        },
    )
    def check(
        request: Request,
        forwarded_method: Annotated[
            str | None, Header(alias="X-Forwarded-Method")
        ] = None,
        forwarded_uri: Annotated[str, Header(alias="X-Forwarded-Uri")] = "",
    ):
        authentication: Authentication = request.app.state.authentication
        principal = resolve_principal(
            authentication,
            request.headers,
            request.cookies,
            forwarded_method or request.method,
            trust_gateway=False,
        )

        if not authorize.execute(principal, forwarded_uri):
            raise AccessError(404, "not_found")

        return Response(
            status_code=204,
            headers={
                "X-User-Id": principal.subject,
                "X-User-Roles": ",".join(sorted(principal.roles)),
            },
        )

    return router
