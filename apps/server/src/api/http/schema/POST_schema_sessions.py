from typing import Annotated

from fastapi import APIRouter, File, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

from api.jobs import SessionCleanupJob
from api.schemas import SessionCreated
from app.ports.tools import DocumentStorageError
from app.use_cases.upload_documents import (
    UploadDocuments,
    UploadDocumentsError,
    UploadedDocument,
)


def register(
    router: APIRouter,
    upload_documents: UploadDocuments,
    cleanup_job: SessionCleanupJob,
) -> None:
    @router.post("/sessions", status_code=201, response_model=SessionCreated)
    async def create_session(files: Annotated[list[UploadFile], File()]):
        documents = [UploadedDocument(file.filename or "", file.file) for file in files]
        try:
            session = await run_in_threadpool(upload_documents.execute, documents)
        except (UploadDocumentsError, DocumentStorageError) as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        finally:
            for file in files:
                await file.close()

        cleanup_job.schedule(session.id)
        return SessionCreated(session_id=session.id)
