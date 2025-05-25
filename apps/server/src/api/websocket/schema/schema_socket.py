import logging

from fastapi import APIRouter, WebSocket
from starlette.websockets import WebSocketDisconnect, WebSocketState

from api.jobs.session_cleanup_job import SessionCleanupJob
from api.schemas.session import (
    ProcessingCompletedMessage,
    ProcessingErrorMessage,
    ProcessingProgressMessage,
)
from app.use_cases.cleanup_session_case import CleanupSession
from app.use_cases.process_documents_case import (
    ProcessDocuments,
    ProcessingCompleted,
    ProcessingError,
    ProcessingProgress,
)
from shared.utils.threading_utils import complete_in_thread

logger = logging.getLogger(__name__)


def create_schema_socket(
    process_documents: ProcessDocuments,
    cleanup_job: SessionCleanupJob,
    cleanup_session: CleanupSession,
) -> APIRouter:
    router = APIRouter(prefix="/schema")

    @router.websocket("/sessions/{session_id}/events")
    async def process_session(websocket: WebSocket, session_id: str):
        await websocket.accept()
        events = process_documents.execute(session_id)
        try:
            await cleanup_job.cancel(session_id)
            while (event := await complete_in_thread(next, events, None)) is not None:
                if isinstance(event, ProcessingError):
                    message = ProcessingErrorMessage(error=event.message)
                elif isinstance(event, ProcessingProgress):
                    message = ProcessingProgressMessage(
                        processed=event.processed,
                        total=event.total,
                        progress=event.processed / event.total * 100,
                    )
                elif isinstance(event, ProcessingCompleted):
                    message = ProcessingCompletedMessage(message=event.schema)
                else:
                    continue
                await websocket.send_json(message.model_dump())
        except WebSocketDisconnect:
            pass
        except Exception as error:
            logger.exception("Failed to process session %s", session_id)
            if websocket.application_state == WebSocketState.CONNECTED:
                await websocket.send_json(
                    ProcessingErrorMessage(error=str(error)).model_dump()
                )
        finally:
            try:
                await complete_in_thread(events.close)
            finally:
                try:
                    await complete_in_thread(cleanup_session.execute, session_id)
                finally:
                    if websocket.application_state == WebSocketState.CONNECTED:
                        await websocket.close()

    return router
