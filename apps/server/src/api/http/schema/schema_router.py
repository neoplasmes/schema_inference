from fastapi import APIRouter

from api.http.schema import register_sessions, register_xsd
from api.jobs import SessionCleanupJob
from app.use_cases.generate_schema import GenerateSchema
from app.use_cases.upload_documents import UploadDocuments


def create_schema_router(
    upload_documents: UploadDocuments,
    generate_schema: GenerateSchema,
    cleanup_job: SessionCleanupJob,
) -> APIRouter:
    router = APIRouter(prefix="/schema")
    register_sessions(router, upload_documents, cleanup_job)
    register_xsd(router, generate_schema)
    return router
