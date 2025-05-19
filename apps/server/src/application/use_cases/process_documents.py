from dataclasses import dataclass
from typing import Generator

from application.use_cases.cleanup_session import CleanupSession
from application.use_cases.infer_schema import InferSchema
from domain.repositories.document import (
    DocumentNotFoundError,
    DocumentRepository,
    InvalidDocumentError,
)
from domain.repositories.session import SessionRepository


@dataclass(frozen=True)
class ProcessingProgress:
    processed: int
    total: int


@dataclass(frozen=True)
class ProcessingError:
    message: str


@dataclass(frozen=True)
class ProcessingCompleted:
    schema: str


ProcessingEvent = ProcessingProgress | ProcessingError | ProcessingCompleted


class ProcessDocuments:
    def __init__(
        self,
        sessions: SessionRepository,
        documents: DocumentRepository,
        infer_schema: InferSchema,
        cleanup_session: CleanupSession,
    ) -> None:
        self._sessions = sessions
        self._documents = documents
        self._infer_schema = infer_schema
        self._cleanup_session = cleanup_session

    def execute(self, session_id: str) -> Generator[ProcessingEvent, None, None]:
        session = self._sessions.get(session_id)
        if session is None:
            yield ProcessingError("Сессия не найдена")
            return

        try:
            if not session.filenames:
                yield ProcessingError("Список файлов пуст")
                return

            trees = []
            for index, filename in enumerate(session.filenames, 1):
                try:
                    trees.append(self._documents.load(session.id, filename))
                except DocumentNotFoundError:
                    yield ProcessingError(f"Файл {filename} не найден")
                    continue
                except InvalidDocumentError:
                    yield ProcessingError(f"Ошибка при разборе {filename}")
                    continue
                yield ProcessingProgress(index, len(session.filenames))

            yield ProcessingCompleted(self._infer_schema.execute(trees))
        finally:
            self._cleanup_session.execute(session_id)
