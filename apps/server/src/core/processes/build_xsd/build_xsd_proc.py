from core.entities import SchemaNode, XmlNode


class XSDBuilder:
    def __init__(self):
        self.namespace = "http://www.w3.org/2001/XMLSchema"

    def build(self, root: SchemaNode) -> XmlNode:
        schema = XmlNode(
            "xs:schema",
            attributes={
                "xmlns:xs": self.namespace,
                "elementFormDefault": "qualified",
                "attributeFormDefault": "unqualified",
            },
        )

        self._process_node(root, schema, is_root=True)
        return schema

    def _process_node(
        self, node: SchemaNode, parent: XmlNode, *, is_root: bool = False
    ) -> None:
        attributes = {"name": node.name}
        if not is_root:
            attributes.update(
                {
                    "minOccurs": str(node.minOccurs),
                    "maxOccurs": str(node.maxOccurs),
                }
            )
        element = parent.add_child("xs:element", attributes)

        if node.chosenType == "parent":
            complex_type = element.add_child("xs:complexType")
            if node.children:
                sequence = complex_type.add_child("xs:sequence")
                for child in node.children:
                    self._process_node(child, sequence)
            if node.attributes:
                for attr_name, attr_type in node.attributes.items():
                    complex_type.add_child(
                        "xs:attribute",
                        {
                            "name": attr_name,
                            "type": f"xs:{attr_type}",
                            "use": "required",
                        },
                    )
        else:
            if node.attributes:
                complex_type = element.add_child("xs:complexType")
                simple_content = complex_type.add_child("xs:simpleContent")
                extension = simple_content.add_child(
                    "xs:extension", {"base": f"xs:{node.chosenType}"}
                )
                for attr_name, attr_type in node.attributes.items():
                    extension.add_child(
                        "xs:attribute",
                        {
                            "name": attr_name,
                            "type": f"xs:{attr_type}",
                            "use": "required",
                        },
                    )
            else:
                element.attributes["type"] = f"xs:{node.chosenType}"


def build_xsd(root: SchemaNode) -> XmlNode:
    return XSDBuilder().build(root)
