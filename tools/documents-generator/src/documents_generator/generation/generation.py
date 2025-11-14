import json
import math
import random
from dataclasses import asdict, dataclass, replace
from pathlib import Path
from typing import Any

from documents_generator.rendering import render_document
from documents_generator.scenarios import FORBIDDEN_ROLE_PAIRS, SCENARIOS
from documents_generator.variants import build_variant

DISTRIBUTIONS = ("geometric", "geometric_offset")
FORMATS = ("xml", "yaml")
VARIANT_COUNT = 7


@dataclass(frozen=True)
class GenerationOptions:
    """Settings for one collection with seven repeated structural variants."""

    seed: int = 42
    documents: int = 100
    scenario: str = "orders"
    distribution: str = "geometric"
    format: str = "xml"

    def __post_init__(self) -> None:
        minimum = 6 * VARIANT_COUNT if self.distribution == "geometric_offset" else 7

        if self.documents < minimum:
            raise ValueError(f"This distribution needs at least {minimum} documents")

        if self.scenario not in SCENARIOS and self.scenario != "all":
            raise ValueError(f"Unknown scenario: {self.scenario}")

        if self.distribution not in DISTRIBUTIONS:
            raise ValueError(f"Unknown distribution: {self.distribution}")

        if self.format not in FORMATS:
            raise ValueError(f"Unknown format: {self.format}")


def variant_distribution(documents: int, offset: int) -> tuple[float, list[int]]:
    """Solve the geometric sum and round counts while keeping the exact total."""
    lower = 1.0
    upper = float(documents)

    for _ in range(80):
        ratio = (lower + upper) / 2
        total = sum(offset + ratio**index for index in range(VARIANT_COUNT))

        if total < documents:
            lower = ratio
        else:
            upper = ratio

    ratio = (lower + upper) / 2
    weights = [offset + ratio**index for index in range(VARIANT_COUNT)]
    counts = [math.floor(weight) for weight in weights]
    remaining = documents - sum(counts)
    order = sorted(
        range(VARIANT_COUNT),
        key=lambda index: (-(weights[index] - counts[index]), index),
    )

    for index in order[:remaining]:
        counts[index] += 1

    return ratio, counts


def generate_dataset(output: Path, options: GenerationOptions) -> dict[str, Any]:
    """Write one collection with compact annotations shared by its variants."""
    if options.scenario == "all":
        raise ValueError("Use generate_collections to produce every scenario")

    output.mkdir(parents=True, exist_ok=True)
    (output / "documents").mkdir(exist_ok=True)
    offset = 5 if options.distribution == "geometric_offset" else 0
    ratio, counts = variant_distribution(options.documents, offset)
    documents: list[dict[str, Any]] = []
    variants: list[dict[str, Any]] = []
    groups: dict[str, list[dict[str, Any]]] = {}
    index = 0

    for variant, count in enumerate(counts):
        root = build_variant(SCENARIOS[options.scenario], variant, options.seed)
        first_nodes: list[dict[str, Any]] = []
        first_identifier = ""

        for occurrence in range(count):
            identifier = f"{options.scenario}-{index + 1:03d}"
            relative = f"documents/{identifier}.{options.format}"
            nodes = render_document(root, output / relative, options.format, index)
            documents.append(
                {
                    "id": identifier,
                    "path": relative,
                    "family": options.scenario,
                    "format": options.format,
                    "variant": variant,
                }
            )

            if occurrence == 0:
                first_nodes = nodes
                first_identifier = identifier

            index += 1

        variants.append({"id": variant, "count": count, "nodes": first_nodes})

        for node in first_nodes:
            groups.setdefault(node["role"], []).append(
                {"document": first_identifier, "locator": node["locator"]}
            )

    random.Random(options.seed).shuffle(documents)
    roles = set(groups)
    manifest = {
        "schema_version": 2,
        "seed": options.seed,
        "scenario": options.scenario,
        "format": options.format,
        "parameters": asdict(options),
        "distribution": {
            "kind": options.distribution,
            "offset": offset,
            "ratio": ratio,
            "counts": counts,
        },
        "variants": variants,
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


def generate_collections(
    output: Path,
    options: GenerationOptions,
    distributions: tuple[str, ...] = DISTRIBUTIONS,
    formats: tuple[str, ...] = FORMATS,
) -> list[Path]:
    """Keep each family, format and distribution in its own document collection."""
    families = list(SCENARIOS) if options.scenario == "all" else [options.scenario]
    manifests = []

    for family in families:
        for distribution in distributions:
            for file_format in formats:
                directory = output / f"{family}-{distribution}-{file_format}"
                selected = replace(
                    options,
                    scenario=family,
                    distribution=distribution,
                    format=file_format,
                )
                generate_dataset(directory, selected)
                manifests.append(directory / "manifest.json")

    return manifests
