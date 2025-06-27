import json
import xml.etree.ElementTree as ET
from collections import defaultdict
from itertools import combinations, product
from pathlib import Path
from typing import Any

type Reference = tuple[str, tuple[int, ...], str]
type Pair = tuple[str, str]


def _pair(left: str, right: str) -> Pair:
    ordered = sorted((left, right))

    return ordered[0], ordered[1]


def _qname(name: dict[str, str]) -> str:
    local = name["local"]

    return f"{{{name['namespace']}}}{local}" if name["namespace"] else local


def _reference(value: dict[str, Any]) -> Reference:
    return (
        value["document"],
        tuple(value["locator"]),
        value.get("attribute", ""),
    )


def _node_paths(root: ET.Element) -> dict[tuple[int, ...], tuple[str, ...]]:
    paths = {}
    pending: list[tuple[ET.Element, tuple[int, ...], tuple[str, ...]]] = [
        (root, (), (root.tag,))
    ]

    while pending:
        node, locator, path = pending.pop()
        paths[locator] = path
        pending.extend(
            (child, (*locator, index), (*path, child.tag))
            for index, child in enumerate(node)
        )

    return paths


def _resolve_profiles(
    manifest: dict[str, Any], input_directory: Path, result: dict[str, Any]
) -> tuple[dict[Reference, str], dict[str, set[str]], list[dict[str, Any]]]:
    by_path = {
        tuple(_qname(name) for name in profile["path"]): profile["id"]
        for profile in result["profiles"]
    }
    references = {}
    roles = defaultdict(set)
    missing = []

    for document in manifest["documents"]:
        root = ET.parse(input_directory / document["path"]).getroot()
        paths = _node_paths(root)

        for node in document["nodes"]:
            reference = {"document": document["id"], **node}
            profile = by_path.get(paths[tuple(node["locator"])])

            if profile is None:
                missing.append(reference)

                continue

            references[_reference(reference)] = profile

            if node["kind"] == "element":
                roles[profile].add(node["role"])

    return references, dict(roles), missing


def _gold_pairs(
    manifest: dict[str, Any], references: dict[Reference, str]
) -> tuple[set[Pair], set[Pair], int, int]:
    expected = set()
    by_role = defaultdict(set)
    already_identical = 0
    attribute_pairs = 0

    for group in manifest["correspondence_groups"]:
        members = [_reference(member) for member in group["members"]]

        for member in members:
            if member in references and not member[2]:
                by_role[group["role"]].add(references[member])

        for left, right in combinations(members, 2):
            if left[0] == right[0]:
                continue

            if left[2] or right[2]:
                attribute_pairs += 1

                continue

            if left not in references or right not in references:
                continue

            if references[left] == references[right]:
                already_identical += 1

                continue

            expected.add(_pair(references[left], references[right]))

    forbidden = set()

    for left_role, right_role in manifest.get("forbidden_role_pairs", []):
        forbidden.update(
            _pair(left, right)
            for left, right in product(by_role[left_role], by_role[right_role])
        )

    return expected, forbidden, already_identical, attribute_pairs


def _metrics(predicted: set[Pair], expected: set[Pair]) -> dict[str, Any]:
    true_positive = len(predicted & expected)

    return {
        "true_positive": true_positive,
        "false_positive": len(predicted - expected),
        "false_negative": len(expected - predicted),
        "precision": true_positive / len(predicted) if predicted else None,
        "recall": true_positive / len(expected) if expected else None,
    }


def evaluate_manifest(
    manifest: dict[str, Any],
    input_directory: Path,
    result: dict[str, Any],
    threshold: float = 0.8,
) -> dict[str, Any]:
    """Compare element hypotheses with an independent oracle without altering inference."""
    references, roles, missing = _resolve_profiles(manifest, input_directory, result)
    expected, forbidden, already_identical, attribute_pairs = _gold_pairs(
        manifest, references
    )
    edges = {
        _pair(edge["left"], edge["right"]): edge
        for edge in result["correspondences"]
        if edge["left"] != edge["right"]
        and edge["left"] in roles
        and edge["right"] in roles
    }
    profiles = {profile["id"]: profile for profile in result["profiles"]}
    candidates = set(edges)
    equivalent = {
        pair for pair, edge in edges.items() if edge["relation"] == "equivalent"
    }
    accepted = {pair for pair in equivalent if edges[pair]["score"] >= threshold}
    same_namespace = {
        pair
        for pair in expected | candidates
        if profiles[pair[0]]["name"]["namespace"]
        == profiles[pair[1]]["name"]["namespace"]
    }
    ranked: dict[str, list[tuple[float, str]]] = defaultdict(list)

    for (left, right), edge in edges.items():
        ranked[left].append((edge["score"], right))
        ranked[right].append((edge["score"], left))

    ranks = {
        (profile, other): index + 1
        for profile, neighbors in ranked.items()
        for index, (_, other) in enumerate(
            sorted(neighbors, key=lambda item: (-item[0], item[1]))
        )
    }
    grouped = {
        _pair(left, right)
        for group in result.get("equivalence_groups", [])
        for left, right in combinations(group, 2)
        if left in roles and right in roles and left != right
    }
    ambiguities = []

    for ambiguity in manifest.get("ambiguity_groups", []):
        required = {
            _pair(references[_reference(left)], references[_reference(right)])
            for left, right in product(ambiguity["left"], ambiguity["right"])
            if _reference(left) in references and _reference(right) in references
        }
        ambiguities.append(
            {
                "expected_alternatives": len(required),
                "retained_alternatives": len(required & candidates),
                "high_confidence_equivalences": len(required & accepted),
            }
        )

    details = []

    for pair in sorted((accepted - expected) | (forbidden & equivalent)):
        edge = edges[pair]
        details.append(
            {
                "left": pair[0],
                "right": pair[1],
                "left_roles": sorted(roles[pair[0]]),
                "right_roles": sorted(roles[pair[1]]),
                "left_name": profiles[pair[0]]["name"],
                "right_name": profiles[pair[1]]["name"],
                "relation": edge["relation"],
                "score": edge["score"],
                "forbidden": pair in forbidden,
                "evidence": edge.get("evidence", []),
                "conflicts": edge.get("conflicts", []),
            }
        )

    return {
        "scenario": manifest["scenario"],
        "element_profile_pairs_expected": len(expected),
        "observations_already_same_profile": already_identical,
        "attribute_or_transform_pairs_not_scored": attribute_pairs,
        "cross_namespace_pairs_expected": len(expected - same_namespace),
        "missing_profile_annotations": missing,
        "candidate_recall": len(candidates & expected) / len(expected)
        if expected
        else None,
        "equivalent": _metrics(equivalent, expected),
        "same_namespace_equivalent": _metrics(
            equivalent & same_namespace, expected & same_namespace
        ),
        "mutual_top_k_candidate_recall": {
            str(limit): sum(
                ranks.get((left, right), float("inf")) <= limit
                and ranks.get((right, left), float("inf")) <= limit
                for left, right in expected
            )
            / len(expected)
            if expected
            else None
            for limit in (1, 3, 5, 10)
        },
        "equivalent_at_threshold": _metrics(accepted, expected),
        "threshold": threshold,
        "thresholds": {
            str(cutoff): _metrics(
                {pair for pair in equivalent if edges[pair]["score"] >= cutoff},
                expected,
            )
            for cutoff in (0.6, 0.7, 0.8, 0.9)
        },
        "forbidden_equivalent_pairs": sorted(forbidden & equivalent),
        "forbidden_group_pairs": sorted(forbidden & grouped),
        "ambiguities": ambiguities,
        "false_positive_details": details,
        "missed_correspondences": [
            {
                "left": left,
                "right": right,
                "left_roles": sorted(roles[left]),
                "right_roles": sorted(roles[right]),
                "left_name": profiles[left]["name"],
                "right_name": profiles[right]["name"],
                "candidate": edges.get((left, right)),
            }
            for left, right in sorted(expected - equivalent)
        ],
    }


def write_evaluation_artifacts(
    destination: Path,
    name: str,
    result: dict[str, Any],
    report: dict[str, Any],
) -> None:
    """Save the actual inference JSON beside metrics for inspection and comparison."""
    destination.mkdir(parents=True, exist_ok=True)

    for suffix, data in (("space", result), ("evaluation", report)):
        (destination / f"{name}.{suffix}.json").write_text(
            json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
            encoding="utf-8",
        )
