from typing import Protocol

from core.entities import XmlDocumentNode


class SchemaWriter(Protocol):
    """Serialize the selected schema tree into an XSD document."""

    def generate(self, root: XmlDocumentNode) -> str: ...
