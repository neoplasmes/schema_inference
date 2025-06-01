from typing import Protocol

from core.entities import XmlNode


class SchemaWriter(Protocol):
    def generate(self, root: XmlNode) -> str: ...
