from typing import BinaryIO, ContextManager, Protocol


class DocumentStorageTool(Protocol):
    """Store, open and remove the input files belonging to an upload session."""

    def save(self, session_id: str, filename: str, source: BinaryIO) -> None: ...

    def open(self, session_id: str, filename: str) -> ContextManager[BinaryIO]: ...

    def remove_session(self, session_id: str) -> None: ...
