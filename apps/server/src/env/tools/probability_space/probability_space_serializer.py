from typing import Any

from core.entities.probability_space import (
    Frequency,
    ProbabilitySpace,
    VariantReference,
)


def serialize_probability_space(space: ProbabilitySpace) -> dict[str, Any]:
    """Render the version-one analysis contract without exposing mutable domain data."""

    def distribution(items: tuple[Frequency[str], ...]) -> list[dict[str, Any]]:
        return [
            {"value": item.value, "count": item.count, "probability": item.probability}
            for item in items
        ]

    def reference(item: VariantReference) -> dict[str, str]:
        return {"node": item.node, "variant": item.variant}

    nodes = []

    for node in space.nodes:
        spellings = [
            {
                "value": item.value.name,
                "count": item.count,
                "probability": item.probability,
                "relation": item.value.relation,
            }
            for item in node.name_alternatives
        ]
        nodes.append(
            {
                "id": node.id,
                "name": node.name,
                "path": list(node.path),
                "occurrences": node.occurrences,
                "parent_occurrences": node.parent_occurrences,
                "presence_count": node.presence_count,
                "presence_probability": node.presence_probability,
                "name_alternatives": spellings,
                "typos": [item for item in spellings if item["relation"] == "typo"],
                "alternative_names": [
                    item for item in spellings if item["relation"] == "alias"
                ],
                "data_types": distribution(node.data_types),
                "representations": distribution(node.representations),
                "content": {
                    "alternatives": [
                        {
                            "id": item.value.id,
                            "kind": item.value.kind,
                            "children": [
                                reference(child) for child in item.value.children
                            ],
                            "count": item.count,
                            "probability": item.probability,
                        }
                        for item in node.variants
                    ]
                },
                "sources": [
                    {
                        "document": source.document,
                        "position": list(source.position),
                        "name": source.name,
                        "representation": source.representation,
                        "variant": source.variant,
                    }
                    for source in node.sources
                ],
            }
        )

    return {
        "format": "document-probability-space",
        "version": 1,
        "statistics": {"documents": space.documents, "fields": len(space.nodes)},
        "roots": [
            {
                **reference(root.value),
                "count": root.count,
                "probability": root.probability,
            }
            for root in space.roots
        ],
        "nodes": nodes,
        "warnings": list(space.warnings),
    }
