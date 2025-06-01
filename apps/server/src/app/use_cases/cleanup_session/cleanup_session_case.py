from app.ports.repos import SessionRepository
from app.ports.tools import DocumentStorageTool


class CleanupSession:
    def __init__(
        self, sessions: SessionRepository, documents: DocumentStorageTool
    ) -> None:
        self._sessions = sessions
        self._documents = documents

    def execute(self, session_id: str) -> None:
        if self._sessions.get(session_id) is None:
            return
        self._documents.remove_session(session_id)
        self._sessions.remove(session_id)
