from typing import Protocol

from domain.entities.session import Session


class SessionRepository(Protocol):
    def add(self, session: Session) -> None: ...

    def get(self, session_id: str) -> Session | None: ...

    def remove(self, session_id: str) -> None: ...
