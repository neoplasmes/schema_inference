from fastapi import FastAPI

from api.http import create_http_server
from api.jobs import SessionCleanupJob
from app.ports.repos import SessionRepository
from app.ports.tools import DocumentStorageTool, XmlDocumentTool
from app.use_cases.cleanup_session import CleanupSession
from app.use_cases.generate_schema import GenerateSchema
from app.use_cases.infer_schema import InferSchema
from app.use_cases.process_documents import ProcessDocuments
from app.use_cases.upload_documents import UploadDocuments
from env.config import Settings
from env.repos.session import InMemorySessionRepository
from env.tools.clustering import ScipyGrammarClusterer
from env.tools.document_storage import FilesystemDocumentStorageTool
from env.tools.lexicon import WordNetLexicon
from env.tools.schema import ElementTreeSchemaWriterTool
from env.tools.similarity import NoopSemanticSimilarity, RapidFuzzSimilarity
from env.tools.xml import ElementTreeXmlDocumentTool


def build_infer_schema(settings: Settings) -> InferSchema:
    return InferSchema(
        lexicon=WordNetLexicon(data_path=settings.wordnet_root),
        text_similarity=RapidFuzzSimilarity(),
        semantic_similarity=NoopSemanticSimilarity(),
        clusterer=ScipyGrammarClusterer(),
    )


def build_generate_schema() -> GenerateSchema:
    return GenerateSchema(ElementTreeSchemaWriterTool())


def create_app(
    *,
    settings: Settings | None = None,
    session_repository: SessionRepository | None = None,
    document_storage: DocumentStorageTool | None = None,
    xml_reader: XmlDocumentTool | None = None,
    infer_schema: InferSchema | None = None,
    generate_schema: GenerateSchema | None = None,
) -> FastAPI:
    configuration = settings if settings is not None else Settings()
    sessions = (
        session_repository
        if session_repository is not None
        else InMemorySessionRepository()
    )
    documents = (
        document_storage
        if document_storage is not None
        else FilesystemDocumentStorageTool(configuration.upload_root)
    )
    reader = xml_reader if xml_reader is not None else ElementTreeXmlDocumentTool()
    inference = (
        infer_schema if infer_schema is not None else build_infer_schema(configuration)
    )
    generation = (
        generate_schema if generate_schema is not None else build_generate_schema()
    )
    cleanup = CleanupSession(sessions, documents)
    cleanup_job = SessionCleanupJob(cleanup, configuration.cleanup_delay)

    return create_http_server(
        upload_documents=UploadDocuments(sessions, documents),
        process_documents=ProcessDocuments(
            sessions, documents, reader, inference, cleanup
        ),
        generate_schema=generation,
        cleanup_session=cleanup,
        cleanup_job=cleanup_job,
        allowed_origins=configuration.allowed_origins,
    )


def start() -> None:
    import uvicorn

    settings = Settings()
    uvicorn.run("main:create_app", factory=True, host=settings.host, port=settings.port)


if __name__ == "__main__":
    start()
