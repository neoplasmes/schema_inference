from core.entities import SelectedSchemaNode, XmlDocumentNode


class XSDBuilder:
    """Translate a selected schema into an XML tree of XSD declarations."""

    def __init__(self):
        """Set the namespace used by generated XSD declarations."""
        self.namespace = "http://www.w3.org/2001/XMLSchema"

    def build(self, root: SelectedSchemaNode) -> XmlDocumentNode:
        """Build the XSD schema wrapper and its selected root element."""
        schema = XmlDocumentNode(
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
        self,
        node: SelectedSchemaNode,
        parent: XmlDocumentNode,
        *,
        is_root: bool = False,
    ) -> None:
        """Append an element declaration with its selected children and attributes."""
        attributes = {"name": node.name}
        value_type = node.chosen_type

        if value_type == "null":
            value_type = "string"
            attributes["nillable"] = "true"

        if not is_root:
            attributes.update(
                {
                    "minOccurs": str(node.min_occurs),
                    "maxOccurs": str(node.max_occurs),
                }
            )
        element = parent.add_child("xs:element", attributes)

        if node.chosen_type == "parent":
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
                    "xs:extension", {"base": f"xs:{value_type}"}
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
                element.attributes["type"] = f"xs:{value_type}"


def build_xsd(root: SelectedSchemaNode) -> XmlDocumentNode:
    """Convert a selected schema into an XSD tree ready for serialization."""
    return XSDBuilder().build(root)
