import json
import random
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from xml_data_generator.scenarios import FORBIDDEN_ROLE_PAIRS, SCENARIOS, Field


@dataclass(frozen=True)
class GenerationOptions:
    seed: int = 42
    documents: int = 8
    scenario: str = "all"
    typo_rate: float = 0.1
    omission_rate: float = 0.2
    attribute_rate: float = 0.15
    reorder_rate: float = 0.5
    max_repeats: int = 3

    def __post_init__(self) -> None:
        if self.documents < 1 or self.max_repeats < 1:
            raise ValueError("documents and max_repeats must be positive")

        if self.scenario != "all" and self.scenario not in SCENARIOS:
            raise ValueError(f"Unknown scenario: {self.scenario}")

        for value in (
            self.typo_rate,
            self.omission_rate,
            self.attribute_rate,
            self.reorder_rate,
        ):
            if not 0 <= value <= 1:
                raise ValueError("Mutation rates must be between zero and one")


def mutate_name(name: str, rng: random.Random) -> tuple[str, str]:
    """Introduce one reproducible edit while preserving a valid XML local name."""
    operation = rng.choice(("substitution", "insertion", "deletion", "transposition"))
    index = rng.randrange(1, len(name)) if len(name) > 1 else 0
    letter = rng.choice("abcdefghijklmnopqrstuvwxyz".replace(name[index], ""))

    if operation == "insertion":
        result = name[:index] + letter + name[index:]
    elif operation == "deletion" and len(name) > 2:
        result = name[:index] + name[index + 1 :]
    elif operation == "transposition" and len(set(name)) > 1:
        positions = [
            position
            for position in range(len(name) - 1)
            if name[position] != name[position + 1]
        ]
        index = rng.choice(positions)
        result = name[:index] + name[index + 1] + name[index] + name[index + 2 :]
    else:
        result = name[:index] + letter + name[index + 1 :]
        operation = "substitution"

    return result, operation


class DocumentBuilder:
    """Build XML and independent role annotations in one deterministic traversal."""

    def __init__(self, options: GenerationOptions, rng: random.Random, index: int):
        self.options = options
        self.rng = rng
        self.index = index
        self.nodes: list[dict[str, Any]] = []
        self.transformations: list[dict[str, Any]] = []
        self.namespace = "urn:example:business" if index % 3 else ""
        self.names: dict[str, str] = {}

    def name(self, field: Field) -> str:
        if field.role not in self.names:
            local = field.names[self.index % len(field.names)]

            if self.rng.random() < self.options.typo_rate:
                changed, operation = mutate_name(local, self.rng)
                self.transformations.append(
                    {
                        "role": field.role,
                        "operation": operation,
                        "from": local,
                        "to": changed,
                    }
                )
                local = changed

            self.names[field.role] = (
                f"{{{self.namespace}}}{local}" if self.namespace else local
            )

        return self.names[field.role]

    def build(self, field: Field, locator: list[int]) -> ET.Element:
        element = ET.Element(self.name(field))
        self.nodes.append(
            {
                "locator": locator,
                "role": field.role,
                "name": element.tag,
                "kind": "element",
            }
        )

        if not field.children:
            element.text = field.value

            return element

        children = list(field.children)

        if self.rng.random() < self.options.reorder_rate:
            self.rng.shuffle(children)
            self.transformations.append({"role": field.role, "operation": "reorder"})

        for child in children:
            if child.optional and self.rng.random() < self.options.omission_rate:
                self.transformations.append({"role": child.role, "operation": "omit"})

                continue

            repeats = (
                self.rng.randint(1, self.options.max_repeats) if child.repeated else 1
            )

            if not child.children and not child.repeated:
                if self.rng.random() < self.options.attribute_rate:
                    attribute = self.name(child)
                    element.set(attribute, child.value)
                    self.nodes.append(
                        {
                            "locator": locator,
                            "attribute": attribute,
                            "role": child.role,
                            "name": attribute,
                            "kind": "attribute",
                        }
                    )
                    self.transformations.append(
                        {"role": child.role, "operation": "attribute"}
                    )

                    continue

            for _ in range(repeats):
                element.append(self.build(child, [*locator, len(element)]))

        return element


def generate_dataset(output: Path, options: GenerationOptions) -> dict[str, Any]:
    """Write a collection and manifest; unrelated existing files are never removed."""
    rng = random.Random(options.seed)
    families = list(SCENARIOS) if options.scenario == "all" else [options.scenario]
    output.mkdir(parents=True, exist_ok=True)
    document_directory = output / "documents"
    document_directory.mkdir(exist_ok=True)
    documents: list[dict[str, Any]] = []
    groups: dict[str, list[dict[str, Any]]] = {}

    for family in families:
        for index in range(options.documents):
            identifier = f"{family}-{index:04d}"
            builder = DocumentBuilder(options, rng, index)
            root = builder.build(SCENARIOS[family], [])

            if builder.namespace:
                ET.register_namespace(
                    "left" if index % 2 else "right", builder.namespace
                )

            ET.indent(root, space="  ")
            relative = f"documents/{identifier}.xml"
            ET.ElementTree(root).write(
                output / relative, encoding="utf-8", xml_declaration=True
            )
            documents.append(
                {
                    "id": identifier,
                    "path": relative,
                    "family": family,
                    "nodes": builder.nodes,
                    "transformations": builder.transformations,
                }
            )

            for node in builder.nodes:
                reference = {"document": identifier, "locator": node["locator"]}

                if node["kind"] == "attribute":
                    reference["attribute"] = node["attribute"]

                groups.setdefault(node["role"], []).append(reference)

    roles = set(groups)
    manifest = {
        "schema_version": 1,
        "seed": options.seed,
        "scenario": options.scenario,
        "parameters": asdict(options),
        "documents": documents,
        "correspondence_groups": [
            {"role": role, "members": members}
            for role, members in sorted(groups.items())
        ],
        "forbidden_role_pairs": [
            [left, right]
            for left, right in FORBIDDEN_ROLE_PAIRS
            if left in roles and right in roles
        ],
        "ambiguity_groups": [],
    }
    (output / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    return manifest
