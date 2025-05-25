import xml.etree.ElementTree as ET
from xml.dom import minidom

from app.ports.tools.schema_writer_tool import SchemaWriter
from core.entities.xml_node import XmlNode


class ElementTreeSchemaWriterTool(SchemaWriter):
    def generate(self, root: XmlNode) -> str:
        element = self._convert_node(root)
        pending = [(root, element)]
        while pending:
            current, target = pending.pop()
            for child in current.children:
                converted = self._convert_node(child)
                target.append(converted)
                pending.append((child, converted))

        serialized = ET.tostring(element, "utf-8")
        formatted = minidom.parseString(serialized)
        return formatted.toprettyxml(indent="  ", encoding="utf-8").decode("utf-8")

    @staticmethod
    def _convert_node(node: XmlNode) -> ET.Element:
        element = ET.Element(node.tag, node.attributes)
        element.text = node.text
        return element
