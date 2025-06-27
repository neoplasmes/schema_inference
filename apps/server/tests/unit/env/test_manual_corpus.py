import json
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path
from typing import Any

import pytest

FIXTURES = Path(__file__).parents[2] / "fixtures" / "manual"
MANIFESTS = sorted(FIXTURES.glob("*/expected.json"))


def reference_key(reference: dict[str, Any]) -> tuple[str, tuple[int, ...], str]:
    return (
        reference["document"],
        tuple(reference["locator"]),
        reference.get("attribute", ""),
    )


def collect_references(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, dict):
        if "document" in value and "locator" in value:
            return [value]

        return [
            reference
            for child in value.values()
            for reference in collect_references(child)
        ]

    if isinstance(value, list):
        return [reference for child in value for reference in collect_references(child)]

    return []


@pytest.mark.parametrize("manifest_path", MANIFESTS, ids=lambda path: path.parent.name)
def test_manual_oracle_is_complete_and_resolves_to_xml(manifest_path: Path) -> None:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    annotated: dict[tuple[str, tuple[int, ...], str], str] = {}
    expected_groups: dict[str, set[tuple[str, tuple[int, ...], str]]] = defaultdict(set)
    document_ids: set[str] = set()

    assert manifest["schema_version"] == 1

    for document in manifest["documents"]:
        identifier = document["id"]

        assert identifier not in document_ids

        document_ids.add(identifier)
        root = ET.parse(manifest_path.parent / document["path"]).getroot()
        actual: set[tuple[str, tuple[int, ...], str]] = set()
        pending: list[tuple[ET.Element, tuple[int, ...]]] = [(root, ())]

        while pending:
            element, position = pending.pop()
            actual.add((identifier, position, ""))
            actual.update((identifier, position, name) for name in element.attrib)
            pending.extend(
                (child, (*position, index)) for index, child in enumerate(element)
            )

        declared: set[tuple[str, tuple[int, ...], str]] = set()

        for node in document["nodes"]:
            assert node["kind"] in {"element", "attribute"}
            assert all(type(index) is int and index >= 0 for index in node["locator"])

            reference = {"document": identifier, **node}
            key = reference_key(reference)

            assert key not in declared

            declared.add(key)
            element = root

            for index in node["locator"]:
                element = element[index]

            if node["kind"] == "attribute":
                assert node["attribute"] in element.attrib
                assert node["name"] == node["attribute"]
            else:
                assert "attribute" not in node
                assert node["name"] == element.tag

            assert node["role"]

            annotated[key] = node["role"]
            expected_groups[node["role"]].add(key)

        assert declared == actual

    actual_groups = {}

    for group in manifest["correspondence_groups"]:
        assert group["role"] not in actual_groups

        members = [reference_key(reference) for reference in group["members"]]

        assert len(set(members)) == len(members)

        actual_groups[group["role"]] = set(members)

    assert actual_groups == dict(expected_groups)

    for left, right in manifest["forbidden_role_pairs"]:
        assert left != right
        assert left in expected_groups
        assert right in expected_groups

    for reference in collect_references(manifest.get("constraints", {})):
        assert reference_key(reference) in annotated

    for ambiguity in manifest.get("ambiguity_groups", []):
        assert ambiguity["resolution"] == "underdetermined"
        assert len(ambiguity["left"]) > 1
        assert len(ambiguity["right"]) > 1

        for reference in collect_references(ambiguity):
            assert reference_key(reference) in annotated
