import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

import yaml

from documents_generator.variants import DocumentNode


def _value(node: DocumentNode, index: int) -> str | int | float:
    if node.role.endswith(".email"):
        local, domain = node.value.split("@", 1)

        return f"{local}{index + 1}@{domain}"

    if node.role.endswith(".phone"):
        return f"+{int(node.value) + index}"

    if node.role.endswith((".quantity", ".count")):
        return int(node.value) + index % 3

    if node.role.endswith((".price", ".amount")):
        return round(float(node.value) + index / 100, 2)

    if node.value.isdigit():
        return str(int(node.value) + index).zfill(len(node.value))

    if node.role.endswith(".date"):
        return f"2025-05-{index % 28 + 1:02d}"

    return f"{node.value} {index + 1}" if index else node.value


def render_document(
    root: DocumentNode, destination: Path, file_format: str, index: int
) -> list[dict[str, Any]]:
    """Write one document and describe its fields independently of inference."""
    nodes: list[dict[str, Any]] = []

    def annotate(node: DocumentNode, locator: list[int]) -> None:
        nodes.append(
            {
                "locator": locator,
                "role": node.role,
                "name": node.name,
                "kind": "element",
            }
        )

    def xml_node(node: DocumentNode, locator: list[int]) -> ET.Element:
        annotate(node, locator)
        element = ET.Element(node.name)

        if not node.children:
            element.text = str(_value(node, index))

        for position, child in enumerate(node.children):
            element.append(xml_node(child, [*locator, position]))

        return element

    def yaml_node(node: DocumentNode, locator: list[int], item: bool = False) -> Any:
        if item:
            nodes.append(
                {
                    "locator": locator,
                    "role": node.role + ".item",
                    "name": "[]",
                    "kind": "element",
                }
            )
        else:
            annotate(node, locator)

        if not node.children:
            return _value(node, index)

        result: dict[str, Any] = {}
        repeated: dict[str, list[DocumentNode]] = {}

        for child in node.children:
            if child.repeated:
                repeated.setdefault(child.name, []).append(child)

        for child in node.children:
            if child.name in result:
                continue

            child_locator = [*locator, len(result)]

            if child.repeated:
                annotate(child, child_locator)
                result[child.name] = [
                    yaml_node(value, [*child_locator, position], item=True)
                    for position, value in enumerate(repeated[child.name])
                ]
            else:
                result[child.name] = yaml_node(child, child_locator)

        return result

    if file_format == "xml":
        element = xml_node(root, [])
        ET.indent(element, space="    ")
        ET.ElementTree(element).write(
            destination, encoding="utf-8", xml_declaration=True
        )
    else:
        document = {root.name: yaml_node(root, [])}
        destination.write_text(
            yaml.safe_dump(document, allow_unicode=True, sort_keys=False, indent=4),
            encoding="utf-8",
        )

    return nodes
