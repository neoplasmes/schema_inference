from dataclasses import dataclass
from typing import ClassVar

from core.entities import DocumentNode


@dataclass
class JsonDocumentNode(DocumentNode):
    """Keep the JSON source identity and its mapping, sequence or scalar type."""

    format: ClassVar[str] = "json"
