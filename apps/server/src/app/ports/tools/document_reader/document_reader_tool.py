from typing import BinaryIO, Protocol

from core.entities import ProbabilitySpaceNode


class DocumentParserStrategy(Protocol):
    """Parse one supported document format into the common node tree."""

    def read(self, source: BinaryIO) -> ProbabilitySpaceNode: ...


class DocumentReaderTool(Protocol):
    """Choose a parser for a file and return its common document tree."""

    def read(self, source: BinaryIO, filename: str) -> ProbabilitySpaceNode: ...
