from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from api.http.root import create_root_router
from api.http.schema import create_schema_router
from api.jobs import SessionCleanupJob
from api.websocket.schema import create_schema_socket
from app.ports.repos.workspace import WorkspaceError
from app.ports.tools.analysis_jobs import AnalysisJobs
from app.use_cases.cleanup_session import CleanupSession
from app.use_cases.generate_schema import GenerateSchema
from app.use_cases.process_documents import ProcessDocuments
from app.use_cases.upload_documents import UploadDocuments


def create_http_server(
    *,
    upload_documents: UploadDocuments,
    process_documents: ProcessDocuments,
    generate_schema: GenerateSchema,
    cleanup_session: CleanupSession,
    cleanup_job: SessionCleanupJob,
    allowed_origins: tuple[str, ...],
    analysis_jobs: AnalysisJobs | None = None,
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(server: FastAPI):
        if analysis_jobs is not None:
            analysis_jobs.start()

        try:
            yield
        finally:
            await cleanup_job.shutdown()

            if analysis_jobs is not None:
                await run_in_threadpool(analysis_jobs.shutdown)

    server = FastAPI(lifespan=lifespan)

    @server.exception_handler(WorkspaceError)
    async def workspace_error(request: Request, error: WorkspaceError):
        statuses = {
            "not_found": 404,
            "invalid_input": 422,
            "invalid_cursor": 400,
            "not_ready": 409,
            "idempotency_conflict": 409,
            "revision_conflict": 412,
            "precondition_required": 428,
        }

        return JSONResponse(
            status_code=statuses[error.code],
            content={"code": error.code, "message": str(error)},
        )

    server.add_middleware(
        CORSMiddleware,
        allow_origins=list(allowed_origins),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["ETag", "Location"],
    )
    server.include_router(create_root_router())
    server.include_router(
        create_schema_router(upload_documents, generate_schema, cleanup_job)
    )
    server.include_router(
        create_schema_socket(process_documents, cleanup_job, cleanup_session)
    )
    return server
