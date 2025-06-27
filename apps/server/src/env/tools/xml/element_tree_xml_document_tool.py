import xml.etree.ElementTree as ET
from typing import BinaryIO, cast

from app.ports.tools import InvalidDocumentError, XmlDocumentTool
from core.entities import XmlNode


class ElementTreeXmlDocumentTool(XmlDocumentTool):
    def read(self, source: BinaryIO) -> XmlNode:
        """Retain namespace scopes and copy text after the complete parse."""
        contexts: dict[ET.Element, dict[str, str]] = {}
        scopes: list[dict[str, str]] = []
        declarations: dict[str, str] = {}
        element: ET.Element | None = None

        try:
            parser = ET.iterparse(source, events=("start-ns", "start", "end"))

            for event, value in parser:
                if event == "start-ns":
                    prefix, namespace = cast(tuple[str, str], value)
                    declarations[prefix or ""] = namespace
                elif event == "start":
                    if element is None:
                        element = value

                    scope = (
                        dict(scopes[-1])
                        if scopes
                        else {"xml": "http://www.w3.org/XML/1998/namespace"}
                    )
                    scope.update(declarations)
                    declarations.clear()
                    contexts[value] = scope
                    scopes.append(scope)
                else:
                    scopes.pop()

        except ET.ParseError as error:
            raise InvalidDocumentError(str(error)) from error

        if element is None:
            raise InvalidDocumentError("The XML document has no root element.")

        root = self._convert_node(element, contexts[element])
        pending = [(element, root)]

        while pending:
            current, target = pending.pop()

            for child in current:
                converted = self._convert_node(child, contexts[child])
                target.children.append(converted)
                pending.append((child, converted))

        return root

    @staticmethod
    def _convert_node(element: ET.Element, namespaces: dict[str, str]) -> XmlNode:
        return XmlNode(
            element.tag,
            element.text,
            dict(element.attrib),
            tail=element.tail,
            namespaces=namespaces,
        )
