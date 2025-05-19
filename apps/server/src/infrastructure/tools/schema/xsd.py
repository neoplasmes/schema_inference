import xml.etree.ElementTree as ET
from xml.dom import minidom

from domain.entities.schema_node import SchemaNode


class XSDGenerator:
    def __init__(self):
        self.namespace = "http://www.w3.org/2001/XMLSchema"

    def generate(self, root: SchemaNode) -> str:
        schema = ET.Element(
            "xs:schema",
            {
                "xmlns:xs": self.namespace,
                "elementFormDefault": "qualified",
                "attributeFormDefault": "unqualified",
            },
        )

        self._process_node(root, schema)
        return self._format_xml(schema)

    def _process_node(self, node: SchemaNode, parent: ET.Element) -> None:
        element = ET.SubElement(
            parent,
            "xs:element",
            {
                "name": node.name,
                "minOccurs": str(node.minOccurs),
                "maxOccurs": "unbounded" if node.maxOccurs > 1 else str(node.maxOccurs),
            },
        )

        if node.chosenType == "parent":
            complex_type = ET.SubElement(element, "xs:complexType")
            if node.children:
                sequence = ET.SubElement(complex_type, "xs:sequence")
                for child in node.children:
                    self._process_node(child, sequence)
            if node.attributes:
                for attr_name, attr_type in node.attributes.items():
                    ET.SubElement(
                        complex_type,
                        "xs:attribute",
                        {
                            "name": attr_name,
                            "type": f"xs:{attr_type}",
                            "use": "required",
                        },
                    )
        else:
            if node.attributes:
                complex_type = ET.SubElement(element, "xs:complexType")
                simple_content = ET.SubElement(complex_type, "xs:simpleContent")
                extension = ET.SubElement(
                    simple_content, "xs:extension", {"base": f"xs:{node.chosenType}"}
                )
                for attr_name, attr_type in node.attributes.items():
                    ET.SubElement(
                        extension,
                        "xs:attribute",
                        {
                            "name": attr_name,
                            "type": f"xs:{attr_type}",
                            "use": "required",
                        },
                    )
            else:
                element.set("type", f"xs:{node.chosenType}")

    def _format_xml(self, element: ET.Element) -> str:
        rough_string = ET.tostring(element, "utf-8")
        reparsed = minidom.parseString(rough_string)
        return reparsed.toprettyxml(indent="  ", encoding="utf-8").decode("utf-8")

