import asyncio
import json
import logging
from typing import Callable, TypeVar

from fastapi import APIRouter, File, HTTPException, Request, UploadFile, WebSocket
from fastapi.responses import JSONResponse, StreamingResponse
from starlette.concurrency import run_in_threadpool
from starlette.websockets import WebSocketDisconnect, WebSocketState

from api.tasks import SessionCleanupScheduler
from application.use_cases.cleanup_session import CleanupSession
from application.use_cases.generate_schema import GenerateSchema
from application.use_cases.process_documents import (
    ProcessDocuments,
    ProcessingCompleted,
    ProcessingError,
    ProcessingProgress,
)
from application.use_cases.upload_documents import UploadedDocument, UploadDocuments


logger = logging.getLogger(__name__)
Result = TypeVar("Result")


async def _complete_in_threadpool(function: Callable[..., Result], *args) -> Result:
    """Finish the worker before propagating cancellation to its caller."""
    worker = asyncio.create_task(run_in_threadpool(function, *args))
    cancellation = None
    while not worker.done():
        try:
            await asyncio.shield(worker)
        except asyncio.CancelledError as error:
            cancellation = error
    result = worker.result()
    if cancellation is not None:
        raise cancellation
    return result


def create_schema_router(
    upload_documents: UploadDocuments,
    process_documents: ProcessDocuments,
    generate_schema: GenerateSchema,
    cleanup_scheduler: SessionCleanupScheduler,
    cleanup_session: CleanupSession,
) -> APIRouter:
    router = APIRouter(prefix="/schema")

    @router.post("/uploadfiles/")
    async def create_upload_files(files: list[UploadFile] = File(...)):
        documents = [UploadedDocument(file.filename or "", file.file) for file in files]
        try:
            session = await run_in_threadpool(upload_documents.execute, documents)
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        finally:
            for file in files:
                await file.close()

        cleanup_scheduler.schedule(session.id)
        return JSONResponse(
            content={
                "message": "Файлы загружены, подключитесь к WebSocket для обработки",
                "session_id": session.id,
            }
        )

    @router.websocket("/ws/process/{session_id}")
    async def websocket_process(websocket: WebSocket, session_id: str):
        await websocket.accept()
        events = process_documents.execute(session_id)
        try:
            await cleanup_scheduler.cancel(session_id)
            while (event := await _complete_in_threadpool(next, events, None)) is not None:
                if isinstance(event, ProcessingError):
                    await websocket.send_json({"error": event.message})
                elif isinstance(event, ProcessingProgress):
                    await websocket.send_json(
                        {
                            "status": "progress",
                            "processed": event.processed,
                            "total": event.total,
                            "progress": event.processed / event.total * 100,
                        }
                    )
                elif isinstance(event, ProcessingCompleted):
                    await websocket.send_json(
                        {
                            "status": "completed",
                            "message": event.schema,
                            "details": "Все XML-файлы успешно обработаны",
                        }
                    )
        except WebSocketDisconnect:
            pass
        except Exception as error:
            logger.exception("Failed to process session %s", session_id)
            if websocket.application_state == WebSocketState.CONNECTED:
                await websocket.send_json({"error": str(error)})
        finally:
            try:
                await _complete_in_threadpool(events.close)
            finally:
                try:
                    await _complete_in_threadpool(cleanup_session.execute, session_id)
                finally:
                    if websocket.application_state == WebSocketState.CONNECTED:
                        await websocket.close()

    @router.post("/generatexsd/")
    async def generate_xsd(request: Request):
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

    return router
