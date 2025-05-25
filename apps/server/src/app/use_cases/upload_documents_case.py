import time
from dataclasses import dataclass
from typing import BinaryIO, Sequence
from uuid import uuid4

from core.entities.session import Session
from app.ports.tools.document_storage_tool import DocumentStorageTool
from app.ports.repos.session_repo import SessionRepository
from app.use_cases.upload_documents_error import UploadDocumentsError


@dataclass(frozen=True)
class UploadedDocument:
    filename: str
    source: BinaryIO


class UploadDocuments:
    def __init__(
        self, sessions: SessionRepository, documents: DocumentStorageTool
    ) -> None:
        self._sessions = sessions
        self._documents = documents

    def execute(self, documents: Sequence[UploadedDocument]) -> Session:
        filenames = tuple(document.filename for document in documents)
        if len(set(filenames)) != len(filenames):
            raise UploadDocumentsError("Имена загружаемых файлов должны быть уникальными")

        session = Session(str(uuid4()), filenames, time.time())
        try:
            for document in documents:
                self._documents.save(session.id, document.filename, document.source)
            self._sessions.add(session)
        except Exception:
            self._documents.remove_session(session.id)
            raise
        return session
