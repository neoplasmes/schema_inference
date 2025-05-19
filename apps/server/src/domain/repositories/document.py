from typing import BinaryIO, Protocol
from xml.etree.ElementTree import ElementTree


class DocumentNotFoundError(Exception):
    pass


class InvalidDocumentError(Exception):
    pass


class DocumentRepository(Protocol):
    def save(self, session_id: str, filename: str, source: BinaryIO) -> None: ...

    def load(self, session_id: str, filename: str) -> ElementTree: ...

    def remove_session(self, session_id: str) -> None: ...
