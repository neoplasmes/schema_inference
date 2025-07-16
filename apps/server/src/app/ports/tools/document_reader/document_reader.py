from typing import BinaryIO, Protocol

from core.entities import DocumentNode


class DocumentParserStrategy(Protocol):
    """Parse one supported document format into the common node tree."""

    def read(self, source: BinaryIO) -> DocumentNode: ...


class DocumentReaderTool(Protocol):
    """Choose a parser for a file and return its common document tree."""

    def read(self, source: BinaryIO, filename: str) -> DocumentNode: ...
