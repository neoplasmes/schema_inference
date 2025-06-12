from collections import Counter, defaultdict
from collections.abc import Sequence
from itertools import count
from typing import Any

from core.entities.inference import InferenceLimits, NormalizedNode
from core.entities.lexical import LexiconData
from core.processes.match_field_names import match_field_names


def _distribution(counts: Counter) -> list[dict[str, Any]]:
    total = sum(counts.values())

    return [
        {"value": value, "count": amount, "probability": amount / total}
        for value, amount in counts.items()
    ]


def build_probability_space(
    roots: Sequence[NormalizedNode],
    lexicon: LexiconData | None = None,
    limits: InferenceLimits | None = None,
) -> dict[str, Any]:
    """Count observed structures using unordered signatures and local identifiers."""
    lexicon = lexicon if lexicon is not None else LexiconData(unigrams={})
    limits = limits or InferenceLimits()
    nodes: list[dict[str, Any]] = []
    references: dict[int, tuple[str, str]] = {}
    variant_ids = count(1)
    warnings = dict.fromkeys(lexicon.warnings)

    def collect(
        families: list[list[tuple[int, NormalizedNode]]], path: tuple[str, ...]
    ) -> None:
        names = [[node.name for _, node in family] for family in families]
        matches = match_field_names(names, lexicon, limits.max_names)

        if len(matches) > limits.max_names:
            warnings["name_comparison_limit_reached"] = None

        groups: dict[str, list[tuple[int, int, NormalizedNode]]] = defaultdict(list)

        for parent, family in enumerate(families):
            for document, node in family:
                groups[matches[node.name][0]].append((parent, document, node))

        for name, members in groups.items():
            field_path = (*path, name)
            identifier = f"field_{len(nodes) + 1}"
            field: dict[str, Any] = {
                "id": identifier,
                "name": name,
                "path": list(field_path),
            }
            nodes.append(field)
            children = [
                [(document, child) for child in node.children]
                for _, document, node in members
            ]
            collect(children, field_path)
            variants: dict[tuple[str, frozenset[tuple[str, str]]], dict[str, Any]] = {}

            for _, _, node in members:
                child_refs = dict.fromkeys(
                    references[id(child)] for child in node.children
                )
                kind = "fields" if node.data_type == "parent" else "value"
                signature = (kind, frozenset(child_refs))

                if signature not in variants:
                    variants[signature] = {
                        "id": f"variant_{next(variant_ids)}",
                        "kind": kind,
                        "children": [
                            {"node": child, "variant": variant}
                            for child, variant in child_refs
                        ],
                        "count": 0,
                    }

                variant = variants[signature]
                variant["count"] += 1
                references[id(node)] = (identifier, variant["id"])

            total = len(members)
            present = len({parent for parent, _, _ in members})
            name_counts = Counter(node.name for _, _, node in members)
            spellings = [
                {**item, "relation": matches[item["value"]][1]}
                for item in _distribution(name_counts)
            ]
            field.update(
                {
                    "occurrences": total,
                    "parent_occurrences": len(families),
                    "presence_count": present,
                    "presence_probability": present / len(families),
                    "name_alternatives": spellings,
                    "typos": [item for item in spellings if item["relation"] == "typo"],
                    "alternative_names": [
                        item for item in spellings if item["relation"] == "alias"
                    ],
                    "data_types": _distribution(
                        Counter(node.data_type for _, _, node in members)
                    ),
                    "representations": _distribution(
                        Counter(node.representation for _, _, node in members)
                    ),
                    "content": {
                        "alternatives": [
                            {**variant, "probability": variant["count"] / total}
                            for variant in variants.values()
                        ]
                    },
                    "sources": [
                        {
                            "document": document,
                            "position": list(node.position),
                            "name": node.name,
                            "representation": node.representation,
                            "variant": references[id(node)][1],
                        }
                        for _, document, node in members
                    ],
                }
            )

    collect([[(index, root)] for index, root in enumerate(roots)], ())
    root_counts = Counter(references[id(root)] for root in roots)

    return {
        "format": "document-probability-space",
        "version": 1,
        "statistics": {"documents": len(roots), "fields": len(nodes)},
        "roots": [
            {
                "node": node,
                "variant": variant,
                "count": amount,
                "probability": amount / len(roots),
            }
            for (node, variant), amount in root_counts.items()
        ],
        "nodes": nodes,
        "warnings": list(warnings),
    }
