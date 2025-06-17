import re
from collections.abc import Sequence
from typing import Literal

from core.entities.matching import (
    AlignmentRequest,
    AlignmentResult,
    CandidateBatch,
    CandidatePair,
    Correspondence,
    MatchingConfig,
)
from core.entities.observations import NodeProfile, ObservedCorpus
from core.processes.score_correspondences import ScoreCorrespondencesError


def prepare_alignments(
    corpus: ObservedCorpus,
    candidates: CandidateBatch,
    previous: Sequence[Correspondence] = (),
    config: MatchingConfig | None = None,
) -> tuple[AlignmentRequest, ...]:
    """Prepare bounded child matrices as data for an application-provided solver."""
    config = config or MatchingConfig()
    profiles = {profile.profile_id: profile for profile in corpus.profiles}
    slots = {profile_id: _slots(profile) for profile_id, profile in profiles.items()}
    names = {
        _pair(pair.left, pair.right): pair.name_match.score for pair in candidates.pairs
    }
    scores = {_pair(item.left, item.right): item.score for item in previous}
    requests: list[AlignmentRequest] = []

    for candidate in candidates.pairs:
        left = slots[candidate.left]
        right = slots[candidate.right]
        left_slots = left[: config.max_child_slots]
        right_slots = right[: config.max_child_slots]
        weights: list[tuple[float, ...]] = []

        for first in left_slots:
            row: list[float] = []

            for second in right_slots:
                key = _pair(first, second)
                same_name = profiles[first].name == profiles[second].name
                lexical = 1.0 if same_name else names.get(key, 0.0)
                propagated = scores.get(key, 0.0) * 0.8
                shape = 0.18 if bool(slots[first]) == bool(slots[second]) else 0.0
                row.append(round(max(lexical, propagated, shape), 6))

            weights.append(tuple(row))

        requests.append(
            AlignmentRequest(
                request_id=candidate.id,
                weights=tuple(weights),
                left_slots=left_slots,
                right_slots=right_slots,
                left_total=len(left),
                right_total=len(right),
                truncated=len(left) > len(left_slots) or len(right) > len(right_slots),
            )
        )

    return tuple(requests)


def score_correspondences(
    corpus: ObservedCorpus,
    candidates: CandidateBatch,
    requests: Sequence[AlignmentRequest],
    results: Sequence[AlignmentResult],
    previous: Sequence[Correspondence] = (),
    config: MatchingConfig | None = None,
) -> tuple[Correspondence, ...]:
    """Combine lexical and contextual evidence while preserving role contradictions."""
    config = config or MatchingConfig()
    profiles = {profile.profile_id: profile for profile in corpus.profiles}
    observed_types = {
        profile_id: _types(profile) for profile_id, profile in profiles.items()
    }
    observed_attributes = {
        profile_id: _attributes(profile) for profile_id, profile in profiles.items()
    }
    request_map = {request.request_id: request for request in requests}
    result_map = {result.request_id: result for result in results}
    candidate_ids = {candidate.id for candidate in candidates.pairs}

    if (
        len(request_map) != len(requests)
        or len(result_map) != len(results)
        or set(request_map) != candidate_ids
        or set(result_map) != candidate_ids
    ):
        raise ScoreCorrespondencesError(
            "Every candidate requires exactly one request and result."
        )

    candidate_map = {_pair(item.left, item.right): item for item in candidates.pairs}
    previous_map = {_pair(item.left, item.right): item for item in previous}
    output: list[Correspondence] = []

    for candidate in candidates.pairs:
        left = profiles[candidate.left]
        right = profiles[candidate.right]
        request = request_map[candidate.id]
        assignment = result_map[candidate.id]
        _validate_assignment(request, assignment)
        total = max(
            request.left_total,
            request.right_total,
            len(request.left_slots),
            len(request.right_slots),
        )
        children = (
            sum(request.weights[row][column] for row, column in assignment.pairs)
            / total
            if total
            else 1.0
        )
        parent = _parent_score(left, right, candidate_map, previous_map)
        value_types = _overlap(
            observed_types[left.profile_id], observed_types[right.profile_id]
        )
        attributes = _overlap(
            observed_attributes[left.profile_id], observed_attributes[right.profile_id]
        )
        cardinality = _cardinality(left, right)
        context_anchors = _context_anchors(request, assignment, candidate_map)
        features = {
            "name": candidate.name_match.score,
            "children": children,
            "parent": parent,
            "value_types": value_types,
            "attributes": attributes,
            "cardinality": cardinality,
            "context_anchors": float(context_anchors),
        }
        weights = {"name": 0.5}

        if total:
            weights.update(children=0.27, cardinality=0.05)

        if left.parent_profile_id and right.parent_profile_id:
            weights["parent"] = 0.15

        if observed_types[left.profile_id] and observed_types[right.profile_id]:
            weights["value_types"] = 0.08

        if (
            observed_attributes[left.profile_id]
            or observed_attributes[right.profile_id]
        ):
            weights["attributes"] = 0.05

        score = sum(features[key] * weight for key, weight in weights.items()) / sum(
            weights.values()
        )
        conflicts = _conflicts(
            left,
            right,
            candidate,
            profiles,
            candidate_map,
            previous_map,
            observed_types,
        )
        evidence = set(candidate.name_match.evidence)

        if "different_namespaces" in conflicts and candidate.name_match.score >= 0.82:
            parent_key = _pair(
                left.parent_profile_id or "", right.parent_profile_id or ""
            )
            parent_match = previous_map.get(parent_key)
            supported_parent = (
                parent_match is not None and parent_match.relation == "equivalent"
            )
            supported_parent = supported_parent or _compound_anchor(
                candidate_map.get(parent_key)
            )
            supported_children = bool(total) and children >= 0.75 and cardinality >= 0.5
            incompatible_context = any(
                "role" in conflict or "context" in conflict for conflict in conflicts
            )

            if not incompatible_context and (supported_parent or supported_children):
                conflicts.remove("different_namespaces")
                evidence.add("namespace_mapping_supported_by_context")

        if request.truncated:
            conflicts.add("child_alignment_truncated")

        if total:
            evidence.add("one_to_one_children_with_unmatched_penalty")
        else:
            evidence.add("leaf_pair")

        if parent >= 0.8:
            evidence.add("compatible_parent_context")

        if value_types >= 0.8 and observed_types[left.profile_id]:
            evidence.add("compatible_observed_value_types")

        if not total and bool(_slots(left)) != bool(_slots(right)):
            conflicts.add("different_node_kinds")

        relation: Literal["equivalent", "shared_structure", "related", "uncertain"]

        if (
            score >= config.equivalence_threshold
            and candidate.name_match.score >= 0.72
            and not conflicts
            and (not total or children >= 0.5)
        ):
            relation = "equivalent"
        elif total and children >= 0.7 and cardinality >= 0.5:
            relation = "shared_structure"
        elif (
            candidate.name_match.score >= 0.4
            and score >= 0.4
            and not any("role" in conflict for conflict in conflicts)
        ):
            relation = "related"
        else:
            relation = "uncertain"

        output.append(
            Correspondence(
                id=candidate.id,
                left=candidate.left,
                right=candidate.right,
                relation=relation,
                score=round(score, 6),
                features=tuple(
                    (key, round(value, 6)) for key, value in sorted(features.items())
                ),
                evidence=tuple(sorted(evidence)),
                conflicts=tuple(sorted(conflicts)),
                choices=(
                    ("left", candidate.name_match.left.tokens),
                    ("right", candidate.name_match.right.tokens),
                ),
            )
        )

    return tuple(output)


def _pair(left: str, right: str) -> tuple[str, str]:
    return (left, right) if left <= right else (right, left)


def _slots(profile: NodeProfile) -> tuple[str, ...]:
    return tuple(
        sorted(
            {
                child
                for variant in profile.child_sequences
                for child in variant.child_profile_ids
            }
        )
    )


def _types(profile: NodeProfile) -> frozenset[str]:
    kinds: set[str] = set()

    for item in profile.observations:
        value = (item.text or "").strip()

        if not value:
            continue

        if value in ("true", "false"):
            kinds.add("boolean")
        elif re.fullmatch(
            r"[+-]?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?", value
        ):
            kinds.add("number")
        elif re.fullmatch(r"\d{4}-\d{2}-\d{2}(?:T.*)?", value):
            kinds.add("date")
        else:
            kinds.add("text")

    return frozenset(kinds)


def _attributes(profile: NodeProfile) -> frozenset[tuple[str, str]]:
    return frozenset(
        (attribute.name.namespace, attribute.name.local_name.casefold())
        for item in profile.observations
        for attribute in item.attributes
        if attribute.name.namespace != "http://www.w3.org/2001/XMLSchema-instance"
    )


def _overlap(left: frozenset, right: frozenset) -> float:
    if not left and not right:
        return 1.0

    return len(left & right) / max(len(left), len(right))


def _cardinality(left: NodeProfile, right: NodeProfile) -> float:
    first = max(
        (len(variant.child_profile_ids) for variant in left.child_sequences),
        default=0,
    )
    second = max(
        (len(variant.child_profile_ids) for variant in right.child_sequences),
        default=0,
    )

    return min(first, second) / max(first, second) if first or second else 1.0


def _parent_score(
    left: NodeProfile,
    right: NodeProfile,
    candidates: dict[tuple[str, str], CandidatePair],
    previous: dict[tuple[str, str], Correspondence],
) -> float:
    if not left.parent_profile_id or not right.parent_profile_id:
        return 0.5

    if left.parent_profile_id == right.parent_profile_id:
        return 1.0

    key = _pair(left.parent_profile_id, right.parent_profile_id)

    if key in previous:
        return previous[key].score

    return candidates[key].name_match.score if key in candidates else 0.0


def _conflicts(
    left: NodeProfile,
    right: NodeProfile,
    candidate: CandidatePair,
    profiles: dict[str, NodeProfile],
    candidates: dict[tuple[str, str], CandidatePair],
    previous: dict[tuple[str, str], Correspondence],
    observed_types: dict[str, frozenset[str]],
) -> set[str]:
    conflicts = set(candidate.name_match.conflicts)

    if (
        left.path == right.path[: len(left.path)]
        or right.path == left.path[: len(right.path)]
    ):
        conflicts.add("ancestor_descendant_roles")

    if left.name.namespace != right.name.namespace:
        conflicts.add("different_namespaces")

    if left.parent_profile_id == right.parent_profile_id and left.parent_profile_id:
        first = {(item.document_id, item.position[:-1]) for item in left.observations}
        second = {(item.document_id, item.position[:-1]) for item in right.observations}

        if first & second:
            conflicts.add("co_occurring_sibling_roles")

    first_parent, second_parent = left.parent_profile_id, right.parent_profile_id
    role_anchored = False

    while first_parent and second_parent and first_parent != second_parent:
        key = _pair(first_parent, second_parent)
        lexical = candidates[key].name_match.conflicts if key in candidates else ()
        propagated = previous[key].conflicts if key in previous else ()

        if any("role" in item for item in (*lexical, *propagated)):
            conflicts.add("ancestor_role_conflict")

            break

        lexical_score = candidates[key].name_match.score if key in candidates else 0.0
        role_anchored = role_anchored or _compound_anchor(candidates.get(key))
        prior = previous.get(key)
        prior_features = dict(prior.features) if prior else {}
        structural_support = (
            prior is not None
            and not any(
                conflict != "different_namespaces" for conflict in prior.conflicts
            )
            and (
                (
                    prior_features.get("name", 0.0) >= 0.4
                    and prior_features.get("children", 0.0) >= 0.55
                )
                or (
                    prior_features.get("context_anchors", 0.0) >= 2
                    and prior_features.get("children", 0.0) >= 0.75
                )
            )
        )

        if lexical_score < 0.72 and not structural_support and not role_anchored:
            conflicts.add("incompatible_ancestor_context")

            break

        first_parent = profiles[first_parent].parent_profile_id
        second_parent = profiles[second_parent].parent_profile_id

    if bool(first_parent) != bool(second_parent):
        conflicts.add("different_context_depths")

    if bool(_slots(left)) != bool(_slots(right)):
        conflicts.add("different_node_kinds")

    if (
        observed_types[left.profile_id]
        and observed_types[right.profile_id]
        and not observed_types[left.profile_id] & observed_types[right.profile_id]
    ):
        conflicts.add("incompatible_observed_value_types")

    return conflicts


def _compound_anchor(candidate: CandidatePair | None) -> bool:
    if candidate is None:
        return False

    lexical = candidate.name_match

    return (
        lexical.score >= 0.85
        and not lexical.conflicts
        and min(len(lexical.left.tokens), len(lexical.right.tokens)) >= 2
    )


def _context_anchors(
    request: AlignmentRequest,
    assignment: AlignmentResult,
    candidates: dict[tuple[str, str], CandidatePair],
) -> int:
    anchors = 0

    for row, column in assignment.pairs:
        key = _pair(request.left_slots[row], request.right_slots[column])
        candidate = candidates.get(key)

        if (
            candidate is None
            or candidate.name_match.conflicts
            or candidate.name_match.score < 0.8
        ):
            continue

        lexical = candidate.name_match
        compound_role = min(len(lexical.left.tokens), len(lexical.right.tokens)) >= 2
        curated_role = any(
            item.startswith("curated_synonym:") for item in lexical.evidence
        )

        if compound_role or curated_role:
            anchors += 1

    return anchors


def _validate_assignment(request: AlignmentRequest, result: AlignmentResult) -> None:
    rows: set[int] = set()
    columns: set[int] = set()

    if len(request.weights) != len(request.left_slots) or any(
        len(row) != len(request.right_slots) for row in request.weights
    ):
        raise ScoreCorrespondencesError(
            "An alignment request has inconsistent matrix dimensions."
        )

    for row, column in result.pairs:
        if (
            row in rows
            or column in columns
            or not 0 <= row < len(request.left_slots)
            or not 0 <= column < len(request.right_slots)
        ):
            raise ScoreCorrespondencesError(
                "An alignment must use valid, distinct rows and columns."
            )

        rows.add(row)
        columns.add(column)
