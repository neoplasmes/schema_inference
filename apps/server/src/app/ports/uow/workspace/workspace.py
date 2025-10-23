from contextlib import AbstractContextManager
from typing import Protocol

from app.ports.repos.workspace import WorkspaceRepository


class WorkspaceUow(Protocol):
    """Open independent read sessions or serialized atomic write transactions."""

    def read(self) -> AbstractContextManager[WorkspaceRepository]: ...
    def transaction(self) -> AbstractContextManager[WorkspaceRepository]: ...
