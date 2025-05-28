from fastapi import FastAPI

from api.http.http_server import create_http_server
from api.jobs.session_cleanup_job import SessionCleanupJob
from app.ports.repos.session_repo import SessionRepository
from app.ports.tools.document_storage_tool import DocumentStorageTool
from app.ports.tools.xml_document_tool import XmlDocumentTool
from app.use_cases.cleanup_session_case import CleanupSession
from app.use_cases.generate_schema_case import GenerateSchema
from app.use_cases.infer_schema_case import InferSchema
from app.use_cases.process_documents_case import ProcessDocuments
from app.use_cases.upload_documents_case import UploadDocuments
from env.config.settings import Settings
from env.repos.session.inmemory_session_repo import InMemorySessionRepository
from env.tools.clustering.scipy_clustering_tool import ScipyGrammarClusterer
from env.tools.document_storage.filesystem_document_storage_tool import (
    FilesystemDocumentStorageTool,
)
from env.tools.lexicon.wordnet_lexicon_tool import WordNetLexicon
from env.tools.schema.element_tree_schema_writer_tool import ElementTreeSchemaWriterTool
from env.tools.similarity.noop_semantic_similarity_tool import NoopSemanticSimilarity
from env.tools.similarity.rapidfuzz_text_similarity_tool import RapidFuzzSimilarity
from env.tools.xml.element_tree_xml_document_tool import ElementTreeXmlDocumentTool


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
