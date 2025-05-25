from typing import BinaryIO, Protocol

from core.entities.xml_node import XmlNode


class XmlDocumentTool(Protocol):
    def read(self, source: BinaryIO) -> XmlNode: ...
