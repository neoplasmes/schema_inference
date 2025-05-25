from fastapi import APIRouter

from api.http.schema.POST_schema_sessions import register as register_sessions
from api.http.schema.POST_schema_xsd import register as register_xsd
from api.jobs.session_cleanup_job import SessionCleanupJob
from app.use_cases.generate_schema_case import GenerateSchema
from app.use_cases.upload_documents_case import UploadDocuments


def create_schema_router(
    upload_documents: UploadDocuments,
    generate_schema: GenerateSchema,
    cleanup_job: SessionCleanupJob,
) -> APIRouter:
    router = APIRouter(prefix="/schema")
    register_sessions(router, upload_documents, cleanup_job)
    register_xsd(router, generate_schema)
    return router
