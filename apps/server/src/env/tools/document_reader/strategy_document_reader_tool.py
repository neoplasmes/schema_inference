from collections.abc import Mapping
from pathlib import Path
from typing import BinaryIO

from app.ports.tools.document_reader import (
    DocumentParserStrategy,
    DocumentReaderTool,
    InvalidDocumentError,
)
from core.entities import DocumentNode


class StrategyDocumentReaderTool(DocumentReaderTool):
    """Select a configured XML or YAML parser using the file extension."""

    def __init__(self, strategies: Mapping[str, DocumentParserStrategy]) -> None:
        self._strategies = dict(strategies)

    def read(self, source: BinaryIO, filename: str) -> DocumentNode:
        extension = Path(filename).suffix.casefold()
        strategy = self._strategies.get(extension)

        if strategy is None:
            raise InvalidDocumentError(
                f"Unsupported document extension: {extension!r}."
            )

        return strategy.read(source)
