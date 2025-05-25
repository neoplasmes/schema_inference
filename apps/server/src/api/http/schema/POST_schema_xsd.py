import json

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool

from app.use_cases.generate_schema_case import GenerateSchema


def register(router: APIRouter, generate_schema: GenerateSchema) -> None:
    @router.post("/xsd", response_class=StreamingResponse)
    async def create_xsd(request: Request):
        try:
            schema = await request.json()
        except json.JSONDecodeError as error:
            raise HTTPException(status_code=422, detail="Некорректный JSON") from error
        if not isinstance(schema, dict):
            raise HTTPException(status_code=422, detail="Ожидается объект схемы")

        try:
            xsd_content = await run_in_threadpool(generate_schema.execute, schema)
        except Exception as error:
            raise HTTPException(
                status_code=500, detail=f"Error generating XSD: {error}"
            ) from error

        return StreamingResponse(
            iter([xsd_content.encode("utf-8")]),
            headers={"Content-Disposition": 'attachment; filename="schema.xsd"'},
            media_type="application/xml",
        )
