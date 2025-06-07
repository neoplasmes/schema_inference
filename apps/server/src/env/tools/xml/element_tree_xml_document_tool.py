import xml.etree.ElementTree as ET
from typing import BinaryIO

from app.ports.tools import InvalidDocumentError, XmlDocumentTool
from core.entities import XmlNode


class ElementTreeXmlDocumentTool(XmlDocumentTool):
    def read(self, source: BinaryIO) -> XmlNode:
        try:
            element = ET.parse(source).getroot()
        except ET.ParseError as error:
            raise InvalidDocumentError(str(error)) from error

        root = self._convert_node(element)
        pending = [(element, root)]

        while pending:
            current, target = pending.pop()

            for child in current:
                converted = self._convert_node(child)
                target.children.append(converted)
                pending.append((child, converted))

        return root

    @staticmethod
    def _convert_node(element: ET.Element) -> XmlNode:
        return XmlNode(
            element.tag,
            element.text,
            dict(element.attrib),
            tail=element.tail,
        )
