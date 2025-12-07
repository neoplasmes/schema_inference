from fastapi import FastAPI

from api.http import create_http_server
from api.http.auth import create_auth_router
from api.http.identity import create_identity_router
from api.http.principal import Authentication
from api.http.workspace import create_workspace_router
from api.jobs import CacheInvalidationJob, SessionCleanupJob
from app.ports.repos import SessionRepository
from app.ports.tools.cache_invalidation import CacheInvalidationTool
from app.ports.tools.document_reader import DocumentReaderTool
from app.ports.tools.document_storage import DocumentStorageTool
from app.ports.tools.identity_cache import IdentityCache
from app.ports.tools.oidc_login import OidcLoginTool
from app.ports.tools.token_introspection import TokenIntrospectionTool
from app.ports.tools.xml_document import XmlDocumentTool
from app.use_cases.apply_changeset import ApplyChangeset
from app.use_cases.apply_identity_event import ApplyIdentityEvent
from app.use_cases.authenticate_token import AuthenticateToken
from app.use_cases.authorize_request import AuthorizeRequest
from app.use_cases.cleanup_session import CleanupSession
from app.use_cases.complete_login import CompleteLogin
from app.use_cases.create_draft import CreateDraft
from app.use_cases.delete_analysis import DeleteAnalysis
from app.use_cases.delete_schema import DeleteSchema
from app.use_cases.dispatch_changes import DispatchChanges
from app.use_cases.generate_schema import GenerateSchema
from app.use_cases.infer_schema import InferSchema
from app.use_cases.logout import Logout
from app.use_cases.process_documents import ProcessDocuments
from app.use_cases.read_workspace import ReadWorkspace
from app.use_cases.run_analysis import RunAnalysis
from app.use_cases.start_analysis import StartAnalysis
from app.use_cases.start_login import StartLogin
from app.use_cases.upload_documents import UploadDocuments
from env.config import Settings, build_log_config, load_settings
from env.repos.session import InMemorySessionRepository
from env.tools.analysis_jobs import ThreadedAnalysisJobs
from env.tools.cache_invalidation import (
    AclCacheInvalidationTool,
    CompositeCacheInvalidationTool,
    NullCacheInvalidationTool,
    SouinCacheInvalidationTool,
)
from env.tools.document_reader import StrategyDocumentReaderTool
from env.tools.document_reader.strategies import (
    ElementTreeXmlDocumentTool,
    JsonDocumentStrategy,
    PyyamlDocumentStrategy,
)
from env.tools.document_storage import FilesystemDocumentStorageTool
from env.tools.identity_cache import NullIdentityCache, ValkeyIdentityCache
from env.tools.lexical import CorpusLexicalResourceTool
from env.tools.oidc_login import ZitadelOidcLoginTool
from env.tools.schema import ElementTreeSchemaWriterTool
from env.tools.schema_expression import EditorSchemaExpressionWriter
from env.tools.token_introspection import ZitadelTokenIntrospectionTool
from env.uow.workspace import PostgresWorkspaceUow


def build_infer_schema(settings: Settings) -> InferSchema:
    return InferSchema(
        expression_writer=EditorSchemaExpressionWriter(),
        lexical_resource=CorpusLexicalResourceTool(
            corpus_directory=settings.wordnet_root
        ),
    )


def build_generate_schema() -> GenerateSchema:
    return GenerateSchema(ElementTreeSchemaWriterTool())


def build_document_reader(
    xml_reader: XmlDocumentTool | None = None,
) -> DocumentReaderTool:
    """Register the input formats available to uploads and local evaluation."""
    xml = xml_reader if xml_reader is not None else ElementTreeXmlDocumentTool()
    yaml = PyyamlDocumentStrategy()

    return StrategyDocumentReaderTool({".xml": xml, ".yaml": yaml, ".yml": yaml})


def build_cache_invalidation(
    settings: Settings, listeners: tuple[CacheInvalidationTool, ...] = ()
) -> CacheInvalidationTool:
    """Purge the gateway cache when configured and notify any extra listeners."""
    gateway: CacheInvalidationTool = (
        SouinCacheInvalidationTool(
            settings.cache_purge_url,
            settings.cache_purge_user,
            settings.cache_purge_password,
        )
        if settings.cache_purge_url
        else NullCacheInvalidationTool()
    )

    return CompositeCacheInvalidationTool([gateway, *listeners])


def build_identity_cache(settings: Settings) -> IdentityCache:
    """Use Valkey when configured, otherwise remember nothing."""
    if settings.valkey_url:
        return ValkeyIdentityCache.from_url(
            settings.valkey_url, marker_ttl=settings.auth_cache_ttl * 2 + 60
        )

    return NullIdentityCache()


def build_token_introspection(settings: Settings) -> TokenIntrospectionTool:
    return ZitadelTokenIntrospectionTool(
        settings.auth_internal_url,
        settings.auth_issuer,
        settings.auth_api_client_id,
        settings.auth_api_client_secret,
        settings.auth_project_id,
    )


def build_oidc_login(settings: Settings) -> OidcLoginTool:
    return ZitadelOidcLoginTool(
        settings.auth_issuer,
        settings.auth_internal_url,
        settings.auth_client_id,
        settings.auth_client_secret,
        settings.auth_project_id,
        settings.auth_redirect_uri,
        settings.auth_post_logout_uri,
    )


def create_app(
    *,
    settings: Settings | None = None,
    session_repository: SessionRepository | None = None,
    document_storage: DocumentStorageTool | None = None,
    xml_reader: XmlDocumentTool | None = None,
    document_reader: DocumentReaderTool | None = None,
    infer_schema: InferSchema | None = None,
    generate_schema: GenerateSchema | None = None,
    cache_invalidation: CacheInvalidationTool | None = None,
    identity_cache: IdentityCache | None = None,
    token_introspection: TokenIntrospectionTool | None = None,
    oidc_login: OidcLoginTool | None = None,
) -> FastAPI:
    configuration = settings if settings is not None else load_settings()
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
    reader = (
        document_reader
        if document_reader is not None
        else build_document_reader(xml_reader)
    )
    inference = (
        infer_schema if infer_schema is not None else build_infer_schema(configuration)
    )
    generation = (
        generate_schema if generate_schema is not None else build_generate_schema()
    )
    cleanup = CleanupSession(sessions, documents)
    cleanup_job = SessionCleanupJob(cleanup, configuration.cleanup_delay)

    store = PostgresWorkspaceUow(configuration.database_url)
    store.initialize()
    workspace_reader = StrategyDocumentReaderTool(
        {
            ".xml": xml_reader or ElementTreeXmlDocumentTool(),
            ".yaml": PyyamlDocumentStrategy(preserve_root=True),
            ".json": JsonDocumentStrategy(),
        }
    )
    identities = (
        identity_cache
        if identity_cache is not None
        else build_identity_cache(configuration)
    )
    introspection = (
        token_introspection
        if token_introspection is not None
        else build_token_introspection(configuration)
    )
    login = oidc_login if oidc_login is not None else build_oidc_login(configuration)
    invalidation = (
        cache_invalidation
        if cache_invalidation is not None
        else build_cache_invalidation(
            configuration, (AclCacheInvalidationTool(identities),)
        )
    )
    invalidation_job = CacheInvalidationJob(DispatchChanges(store, invalidation))
    jobs = ThreadedAnalysisJobs(
        RunAnalysis(store, workspace_reader, inference), invalidation_job.kick
    )
    authentication = Authentication(
        AuthenticateToken(introspection, identities, configuration.auth_cache_ttl),
        configuration.auth_trust_gateway,
        configuration.allowed_origins,
    )
    server = create_http_server(
        analysis_jobs=jobs,
        invalidation_job=invalidation_job,
        upload_documents=UploadDocuments(sessions, documents),
        process_documents=ProcessDocuments(
            sessions, documents, reader, inference, cleanup
        ),
        generate_schema=generation,
        cleanup_session=cleanup,
        cleanup_job=cleanup_job,
        allowed_origins=configuration.allowed_origins,
        authentication=authentication,
    )
    server.include_router(
        create_auth_router(
            StartLogin(login),
            CompleteLogin(login),
            Logout(introspection, identities, login, configuration.auth_client_id),
            AuthorizeRequest(store, identities),
            configuration.auth_cookie_secure,
        )
    )
    server.include_router(
        create_identity_router(
            ApplyIdentityEvent(identities), configuration.auth_webhook_signing_key
        )
    )
    server.include_router(
        create_workspace_router(
            StartAnalysis(store, jobs),
            CreateDraft(store),
            ApplyChangeset(store),
            ReadWorkspace(store),
            DeleteSchema(store),
            DeleteAnalysis(store),
            invalidation_job.kick,
        )
    )

    return server


def start() -> None:
    """Serve the application, reloading on source changes in development."""
    import uvicorn

    settings = load_settings()
    uvicorn.run(
        "main:create_app",
        factory=True,
        host=settings.host,
        port=settings.port,
        reload=settings.is_development,
        log_config=build_log_config(settings.environment),
    )


if __name__ == "__main__":
    start()
