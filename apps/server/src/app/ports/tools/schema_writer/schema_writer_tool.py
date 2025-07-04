from typing import Protocol

from core.entities import XmlNode


class SchemaWriter(Protocol):
    """Serialize the selected schema tree into an XSD document."""

    def generate(self, root: XmlNode) -> str: ...
