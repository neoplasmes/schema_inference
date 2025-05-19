from domain.repositories.document import DocumentRepository
from domain.repositories.session import SessionRepository


class CleanupSession:
    def __init__(
        self, sessions: SessionRepository, documents: DocumentRepository
    ) -> None:
        self._sessions = sessions
        self._documents = documents

    def execute(self, session_id: str) -> None:
        if self._sessions.get(session_id) is None:
            return
        self._documents.remove_session(session_id)
        self._sessions.remove(session_id)
