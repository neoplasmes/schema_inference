from threading import RLock

from app.ports.repos import SessionRepository
from core.entities import Session


class InMemorySessionRepository(SessionRepository):
    def __init__(self) -> None:
        self._sessions: dict[str, Session] = {}
        self._lock = RLock()

    def add(self, session: Session) -> None:
        with self._lock:
            self._sessions[session.id] = session

    def get(self, session_id: str) -> Session | None:
        with self._lock:
            return self._sessions.get(session_id)

    def remove(self, session_id: str) -> None:
        with self._lock:
            self._sessions.pop(session_id, None)
