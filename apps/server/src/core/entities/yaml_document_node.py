from dataclasses import dataclass
from typing import ClassVar

from core.entities import DocumentNode


@dataclass
class YamlDocumentNode(DocumentNode):
    """Keep a YAML field or list item with its mapping, sequence or scalar type."""

    format: ClassVar[str] = "yaml"
