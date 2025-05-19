from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.composition import SERVER_ROOT, build_generate_schema, build_infer_schema
from api.routers.schema import create_schema_router
from api.tasks import SessionCleanupScheduler
from application.use_cases.cleanup_session import CleanupSession
from application.use_cases.generate_schema import GenerateSchema
from application.use_cases.infer_schema import InferSchema
from application.use_cases.process_documents import ProcessDocuments
from application.use_cases.upload_documents import UploadDocuments
from domain.repositories.document import DocumentRepository
from domain.repositories.session import SessionRepository
from infrastructure.repositories.document.filesystem import FilesystemDocumentRepository
from infrastructure.repositories.session.inmemory import InMemorySessionRepository


def create_app(
    *,
    session_repository: SessionRepository | None = None,
    document_repository: DocumentRepository | None = None,
    infer_schema: InferSchema | None = None,
    generate_schema: GenerateSchema | None = None,
    cleanup_delay: float = 300,
) -> FastAPI:
    sessions = (
        session_repository
        if session_repository is not None
        else InMemorySessionRepository()
    )
    documents = (
        document_repository
        if document_repository is not None
        else FilesystemDocumentRepository(SERVER_ROOT / "uploaded_files")
    )
    if infer_schema is None:
        infer_schema = build_infer_schema()
    if generate_schema is None:
        generate_schema = build_generate_schema()

    cleanup_session = CleanupSession(sessions, documents)
    cleanup_scheduler = SessionCleanupScheduler(cleanup_session, cleanup_delay)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        try:
            yield
        finally:
            await cleanup_scheduler.shutdown()

    app = FastAPI(lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(
        create_schema_router(
            UploadDocuments(sessions, documents),
            ProcessDocuments(sessions, documents, infer_schema, cleanup_session),
            generate_schema,
            cleanup_scheduler,
            cleanup_session,
        )
    )

    @app.get("/")
    async def root():
        return {"message": "Hello, FastAPI!"}

    return app


def start() -> None:
    import uvicorn

    uvicorn.run("api.app:app", host="127.0.0.1", port=8000)


app = create_app()
