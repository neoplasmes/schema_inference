from typing import BinaryIO, Protocol

from core.entities import XmlNode


class XmlDocumentTool(Protocol):
    def read(self, source: BinaryIO) -> XmlNode: ...
