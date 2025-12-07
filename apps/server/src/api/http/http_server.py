from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from api.http.cache import CachePolicyMiddleware
from api.http.metrics import expose_metrics
from api.http.principal import AccessError, Authentication
from api.http.root import create_root_router
from api.http.schema import create_schema_router
from api.jobs import CacheInvalidationJob, SessionCleanupJob
from api.websocket.schema import create_schema_socket
from app.ports.repos.workspace import WorkspaceError
from app.ports.tools.analysis_jobs import AnalysisJobs
from app.ports.tools.token_introspection import TokenIntrospectionError
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
    authentication: Authentication,
    analysis_jobs: AnalysisJobs | None = None,
    invalidation_job: CacheInvalidationJob | None = None,
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(server: FastAPI):
        if analysis_jobs is not None:
            analysis_jobs.start()

        if invalidation_job is not None:
            invalidation_job.start()

        try:
            yield
        finally:
            if invalidation_job is not None:
                await run_in_threadpool(invalidation_job.stop)

            await cleanup_job.shutdown()

            if analysis_jobs is not None:
                await run_in_threadpool(analysis_jobs.shutdown)

    server = FastAPI(lifespan=lifespan)
    server.state.authentication = authentication

    @server.exception_handler(AccessError)
    async def access_error(request: Request, error: AccessError):
        headers = {"WWW-Authenticate": "Bearer"} if error.status == 401 else None

        return JSONResponse(
            status_code=error.status, content={"code": error.code}, headers=headers
        )

    @server.exception_handler(TokenIntrospectionError)
    async def identity_unavailable(request: Request, error: TokenIntrospectionError):
        return JSONResponse(status_code=503, content={"code": "identity_unavailable"})

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
    server.add_middleware(CachePolicyMiddleware)
    server.include_router(create_root_router())
    server.include_router(
        create_schema_router(upload_documents, generate_schema, cleanup_job)
    )
    server.include_router(
        create_schema_socket(
            process_documents, cleanup_job, cleanup_session, authentication
        )
    )
    expose_metrics(server)

    return server
