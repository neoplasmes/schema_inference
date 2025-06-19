from collections import defaultdict
from collections.abc import Sequence

from core.entities.matching import Correspondence, HypothesisSpace, MatchingConfig
from core.entities.observations import NodeProfile, ObservedCorpus


def build_hypotheses(
    corpus: ObservedCorpus,
    correspondences: Sequence[Correspondence],
    config: MatchingConfig | None = None,
) -> HypothesisSpace:
    """Suggest only complete-link groups and preserve incompatible competing matches."""
    config = config or MatchingConfig()
    profiles = {profile.profile_id: profile for profile in corpus.profiles}
    eligible = {
        tuple(sorted((item.left, item.right))): item
        for item in correspondences
        if item.relation == "equivalent"
        and item.score >= config.equivalence_threshold
        and not item.conflicts
        and item.left in profiles
        and item.right in profiles
        and item.left != item.right
        and _compatible_roles(profiles[item.left], profiles[item.right])
    }
    partners: dict[str, list[tuple[str, float]]] = defaultdict(list)

    for (left, right), item in eligible.items():
        partners[left].append((right, item.score))
        partners[right].append((left, item.score))

    ambiguous: dict[str, tuple[str, ...]] = {}

    for profile, matches in partners.items():
        best = max(score for _, score in matches)
        close = sorted(
            partner
            for partner, score in matches
            if best - score <= config.ambiguity_margin
        )

        if any(
            tuple(sorted((left, right))) not in eligible
            for index, left in enumerate(close)
            for right in close[index + 1 :]
        ):
            ambiguous[profile] = tuple(close)

    groups = {profile: {profile} for profile in profiles}
    owner = {profile: profile for profile in profiles}

    for (left, right), _ in sorted(
        eligible.items(), key=lambda entry: (-entry[1].score, entry[0])
    ):
        left_owner, right_owner = owner[left], owner[right]

        if left_owner == right_owner:
            continue

        first, second = groups[left_owner], groups[right_owner]

        if any(member in ambiguous for member in first | second):
            continue

        if not all(tuple(sorted((a, b))) in eligible for a in first for b in second):
            continue

        merged = first | second
        groups[left_owner] = merged
        del groups[right_owner]

        for member in second:
            owner[member] = left_owner

    diagnostics = (f"ambiguous_profile_matches:{len(ambiguous)}",) if ambiguous else ()

    return HypothesisSpace(
        groups=tuple(
            sorted(tuple(sorted(group)) for group in groups.values() if len(group) > 1)
        ),
        ambiguities=tuple(sorted(ambiguous.items())),
        diagnostics=diagnostics,
    )


def _compatible_roles(left: NodeProfile, right: NodeProfile) -> bool:
    if (
        left.path == right.path[: len(left.path)]
        or right.path == left.path[: len(right.path)]
    ):
        return False

    if left.parent_profile_id and left.parent_profile_id == right.parent_profile_id:
        first = {(item.document_id, item.position[:-1]) for item in left.observations}
        second = {(item.document_id, item.position[:-1]) for item in right.observations}

        if first & second:
            return False

    return True
