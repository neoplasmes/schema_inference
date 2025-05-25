from typing import Protocol

from core.entities.xml_node import XmlNode


class SchemaWriter(Protocol):
    def generate(self, root: XmlNode) -> str: ...
