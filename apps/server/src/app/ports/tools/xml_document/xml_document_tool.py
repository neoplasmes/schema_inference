from typing import BinaryIO, Protocol

from core.entities import XmlDocumentNode


class XmlDocumentTool(Protocol):
    """Read XML while preserving element content and namespace information."""

    def read(self, source: BinaryIO) -> XmlDocumentNode: ...
