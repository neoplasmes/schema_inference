import json
import time

from fastapi import APIRouter, Request, Response
from starlette.concurrency import run_in_threadpool

from api.http.principal import AccessError
from app.use_cases.apply_identity_event import ApplyIdentityEvent
from core.processes.verify_webhook_signature import verify_webhook_signature

SIGNATURE_HEADER = "ZITADEL-Signature"


def create_identity_router(apply: ApplyIdentityEvent, signing_key: str) -> APIRouter:
    router = APIRouter()

    @router.post("/internal/identity/events", include_in_schema=False)
    async def identity_events(request: Request):
        body = await request.body()

        if not verify_webhook_signature(
            signing_key, request.headers.get(SIGNATURE_HEADER, ""), body, time.time()
        ):
            raise AccessError(401, "invalid_signature")

        try:
            event = json.loads(body)
        except ValueError:
            event = None

        if not isinstance(event, dict):
            raise AccessError(400, "invalid_event")

        await run_in_threadpool(apply.execute, event)

        return Response(status_code=204)

    return router
