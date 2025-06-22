import math
import re
from collections import Counter
from collections.abc import Mapping, Sequence
from datetime import date, datetime
from typing import Any

from core.entities.lexical import Segmentation
from core.entities.observations import ExpandedName, NodeProfile, ObservedCorpus


def build_probability_space(
    corpus: ObservedCorpus,
    *,
    name_analyses: Mapping[str, Sequence[Segmentation]] | None = None,
    correspondences: Sequence[Mapping[str, Any]] = (),
    equivalence_groups: Sequence[Sequence[str]] = (),
    warnings: Sequence[str] = (),
    diagnostics: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Keep observed content alternatives separate from uncertain correspondences."""
    analyses = name_analyses or {}
    profiles = [_profile_data(profile, analyses) for profile in corpus.profiles]
    roots = Counter(document.root_profile_id for document in corpus.documents)
    document_count = corpus.document_count

    return {
        "format": "xml-probability-space",
        "version": 1,
        "statistics": {
            "documents": document_count,
            "nodes": corpus.node_count,
            "profiles": len(profiles),
            "correspondences": len(correspondences),
        },
        "documents": [
            {
                "id": document.document_id,
                "content_hash": document.content_hash,
                "root": document.root_profile_id,
                "nodes": document.node_count,
            }
            for document in corpus.documents
        ],
        "roots": [
            {
                "profile": profile_id,
                "count": count,
                "frequency": count / document_count,
            }
            for profile_id, count in sorted(roots.items())
        ],
        "profiles": profiles,
        "correspondences": [
            {
                **item,
                "score_kind": "heuristic",
                "alternatives": [
                    {"relation": item["relation"], "score": item["score"]},
                    {"relation": "keep_separate", "score": None},
                ],
            }
            for item in correspondences
        ],
        "equivalence_groups": [list(group) for group in equivalence_groups],
        "decision_policy": {
            "observations_are_immutable": True,
            "keep_separate_is_available": True,
            "scores_are_probabilities": False,
            "groups_are_suggestions": True,
        },
        "warnings": sorted(set(warnings)),
        "diagnostics": dict(diagnostics or {}),
    }


def _profile_data(
    profile: NodeProfile, analyses: Mapping[str, Sequence[Segmentation]]
) -> dict[str, Any]:
    total = profile.occurrence_count
    kinds = Counter(item.kind for item in profile.observations)
    nil_values = Counter(
        "unspecified" if item.nil is None else str(item.nil).lower()
        for item in profile.observations
    )
    child_ids = sorted(
        {child for item in profile.observations for child in item.child_profile_ids}
    )
    child_counts = [Counter(item.child_profile_ids) for item in profile.observations]
    attributes: dict[ExpandedName, list[str]] = {}

    for observation in profile.observations:
        for attribute in observation.attributes:
            attributes.setdefault(attribute.name, []).append(attribute.value)

    text_values = [
        item.text
        for item in profile.observations
        if item.kind == "text" and item.nil is not True and item.text is not None
    ]

    return {
        "id": profile.profile_id,
        "name": _name_data(profile.name),
        "path": [_name_data(name) for name in profile.path],
        "parent": profile.parent_profile_id,
        "occurrences": total,
        "document_count": profile.document_count,
        "kinds": _distribution(kinds, total),
        "nil": _distribution(nil_values, total),
        "value_types": _value_types(text_values),
        "name_analyses": [
            {
                "tokens": list(item.tokens),
                "score": item.score,
                "unknown": list(item.unknown),
                "corrections": [list(pair) for pair in item.corrections],
            }
            for item in analyses.get(profile.profile_id, ())
        ],
        "content": {
            "kind": "choice",
            "basis": "node_occurrences",
            "alternatives": [
                {
                    "kind": "sequence" if sequence.child_profile_ids else "empty",
                    "children": list(sequence.child_profile_ids),
                    "count": sequence.count,
                    "frequency": sequence.frequency,
                    "sources": [
                        {"document": item.document_id, "position": list(item.position)}
                        for item in profile.observations
                        if item.child_profile_ids == sequence.child_profile_ids
                    ],
                }
                for sequence in profile.child_sequences
            ],
        },
        "child_cardinalities": [
            {
                "profile": child_id,
                "minimum_observed": min(counts[child_id] for counts in child_counts),
                "maximum_observed": max(counts[child_id] for counts in child_counts),
                "distribution": _distribution(
                    Counter(counts[child_id] for counts in child_counts), total
                ),
            }
            for child_id in child_ids
        ],
        "attributes": [
            {
                "name": _name_data(name),
                "present": len(values),
                "absent": total - len(values),
                "presence_frequency": len(values) / total,
                "value_types": _value_types(values),
            }
            for name, values in sorted(attributes.items())
        ],
        "observations": [
            {
                "document": item.document_id,
                "position": list(item.position),
                "kind": item.kind,
                "nil": item.nil,
                "text": item.text,
                "tail": item.tail,
                "children": list(item.child_profile_ids),
                "attributes": [
                    {"name": _name_data(attribute.name), "value": attribute.value}
                    for attribute in item.attributes
                ],
            }
            for item in profile.observations
        ],
    }


def _name_data(name: ExpandedName) -> dict[str, str]:
    return {"namespace": name.namespace, "local": name.local_name}


def _distribution(counts: Counter, total: int) -> list[dict[str, Any]]:
    return [
        {"value": value, "count": count, "frequency": count / total}
        for value, count in sorted(counts.items())
    ]


def _value_types(values: Sequence[str]) -> dict[str, Any]:
    counts = Counter(kind for value in values for kind in _type_candidates(value))
    total = len(values)

    return {
        "basis": "present_non_nil_values",
        "total": total,
        "candidates": [
            {
                "type": kind,
                "supported_values": count,
                "support_fraction": count / total,
            }
            for kind, count in sorted(counts.items())
        ],
    }


def _type_candidates(raw: str) -> tuple[str, ...]:
    value = raw.strip()
    candidates = ["string"]

    if value in ("true", "false", "0", "1"):
        candidates.append("boolean")

    if re.fullmatch(r"[+-]?(?:0|[1-9][0-9]*)", value):
        candidates.append("integer")

    if re.fullmatch(r"[+-]?(?:[0-9]+\.[0-9]*|\.[0-9]+)", value):
        candidates.append("decimal")

    if re.fullmatch(r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)[eE][+-]?[0-9]+", value):
        if math.isfinite(float(value)):
            candidates.append("double")

    if re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
        try:
            date.fromisoformat(value)
            candidates.append("date")
        except ValueError:
            pass

    if re.fullmatch(
        r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}"
        r"(?:\.[0-9]+)?(?:Z|[+-](?:0[0-9]|1[0-3]):[0-5][0-9]|[+-]14:00)?",
        value,
    ):
        try:
            datetime.fromisoformat(value)
            candidates.append("dateTime")
        except ValueError:
            pass

    return tuple(candidates)
