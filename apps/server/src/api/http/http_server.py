from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.http.root.GET_root import create_root_router
from api.http.schema.schema_router import create_schema_router
from api.jobs.session_cleanup_job import SessionCleanupJob
from api.websocket.schema.schema_socket import create_schema_socket
from app.use_cases.cleanup_session_case import CleanupSession
from app.use_cases.generate_schema_case import GenerateSchema
from app.use_cases.process_documents_case import ProcessDocuments
from app.use_cases.upload_documents_case import UploadDocuments


def create_http_server(
    *,
    upload_documents: UploadDocuments,
    process_documents: ProcessDocuments,
    generate_schema: GenerateSchema,
    cleanup_session: CleanupSession,
    cleanup_job: SessionCleanupJob,
    allowed_origins: tuple[str, ...],
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(server: FastAPI):
        try:
            yield
        finally:
            await cleanup_job.shutdown()

    server = FastAPI(lifespan=lifespan)
    server.add_middleware(
        CORSMiddleware,
        allow_origins=list(allowed_origins),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    server.include_router(create_root_router())
    server.include_router(
        create_schema_router(upload_documents, generate_schema, cleanup_job)
    )
    server.include_router(
        create_schema_socket(process_documents, cleanup_job, cleanup_session)
    )
    return server
