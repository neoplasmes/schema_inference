from collections import Counter, defaultdict
from collections.abc import Sequence
from itertools import count
from typing import Literal, cast

from core.entities.inference import FieldObservation, InferenceLimits
from core.entities.lexical import LexiconData
from core.entities.probability_space import (
    Frequency,
    NameAlternative,
    ObservedField,
    ProbabilitySpace,
    SourceObservation,
    StructuralVariant,
    VariantReference,
)
from core.processes.match_field_names import match_field_names


def _distribution[T](counts: Counter[T]) -> tuple[Frequency[T], ...]:
    """Build outcome frequencies sharing the total count of their observations."""
    total = sum(counts.values())

    return tuple(Frequency(value, amount, total) for value, amount in counts.items())


def build_probability_space(
    roots: Sequence[FieldObservation],
    lexicon: LexiconData | None = None,
    limits: InferenceLimits | None = None,
) -> ProbabilitySpace:
    """Count observed structures using unordered signatures and local identifiers."""
    lexicon = lexicon if lexicon is not None else LexiconData(unigrams={})
    limits = limits or InferenceLimits()
    nodes: dict[str, ObservedField | None] = {}
    references: dict[int, VariantReference] = {}
    variant_ids = count(1)
    warnings = dict.fromkeys(lexicon.warnings)

    def collect(
        families: list[list[tuple[int, FieldObservation]]], path: tuple[str, ...]
    ) -> None:
        """Aggregate fields within one parent path and retain observed child variants."""
        names = [[node.name for _, node in family] for family in families]
        matches = match_field_names(names, lexicon, limits.max_names)

        if len(matches) > limits.max_names:
            warnings["name_comparison_limit_reached"] = None

        groups: dict[str, list[tuple[int, int, FieldObservation]]] = defaultdict(list)

        for parent, family in enumerate(families):
            for document, node in family:
                groups[matches[node.name][0]].append((parent, document, node))

        for name, members in groups.items():
            field_path = (*path, name)
            identifier = f"field_{len(nodes) + 1}"
            nodes[identifier] = None
            children = [
                [(document, child) for child in node.children]
                for _, document, node in members
            ]
            collect(children, field_path)
            variants: dict[
                tuple[str, frozenset[VariantReference]], StructuralVariant
            ] = {}
            variant_counts: Counter[StructuralVariant] = Counter()

            for _, _, node in members:
                child_refs = tuple(
                    dict.fromkeys(references[id(child)] for child in node.children)
                )
                kind = "fields" if node.data_type == "parent" else "value"
                signature = (kind, frozenset(child_refs))

                if signature not in variants:
                    variants[signature] = StructuralVariant(
                        f"variant_{next(variant_ids)}", kind, child_refs
                    )

                variant = variants[signature]
                variant_counts[variant] += 1
                references[id(node)] = VariantReference(identifier, variant.id)

            name_counts = Counter(
                NameAlternative(
                    node.name,
                    cast(Literal["original", "typo", "alias"], matches[node.name][1]),
                )
                for _, _, node in members
            )
            nodes[identifier] = ObservedField(
                id=identifier,
                name=name,
                path=field_path,
                occurrences=len(members),
                parent_occurrences=len(families),
                presence_count=len({parent for parent, _, _ in members}),
                name_alternatives=_distribution(name_counts),
                data_types=_distribution(
                    Counter(node.data_type for _, _, node in members)
                ),
                representations=_distribution(
                    Counter(node.representation for _, _, node in members)
                ),
                variants=_distribution(variant_counts),
                sources=tuple(
                    SourceObservation(
                        document,
                        node.position,
                        node.name,
                        node.representation,
                        references[id(node)].variant,
                    )
                    for _, document, node in members
                ),
            )

    collect([[(index, root)] for index, root in enumerate(roots)], ())

    return ProbabilitySpace(
        documents=len(roots),
        nodes=tuple(node for node in nodes.values() if node is not None),
        roots=_distribution(Counter(references[id(root)] for root in roots)),
        warnings=tuple(warnings),
    )
