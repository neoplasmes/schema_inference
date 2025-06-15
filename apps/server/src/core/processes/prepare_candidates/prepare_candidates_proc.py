from bisect import bisect_left
from collections import Counter, defaultdict
from collections.abc import Mapping

from core.entities.lexical import LexiconData, Segmentation
from core.entities.matching import CandidateBatch, CandidatePair, MatchingConfig
from core.entities.observations import NodeProfile, ObservedCorpus
from core.processes.compare_names import character_ngrams, compare_names
from core.processes.segment_identifier import segment_identifier


def prepare_candidates(
    corpus: ObservedCorpus,
    lexicon: LexiconData,
    analyses: Mapping[str, tuple[Segmentation, ...]] | None = None,
    config: MatchingConfig | None = None,
) -> CandidateBatch:
    """Union lexical and structural indexes within explicit deterministic budgets."""
    config = config or MatchingConfig()
    profiles = {profile.profile_id: profile for profile in corpus.profiles}
    names = dict(analyses or {})
    terms: dict[str, frozenset[str]] = {}
    index: dict[str, list[str]] = defaultdict(list)

    for profile_id, profile in sorted(profiles.items()):
        names.setdefault(profile_id, ())

        if not names[profile_id]:
            names[profile_id] = segment_identifier(profile.name.local_name, lexicon)

        terms[profile_id] = _index_terms(profile, names[profile_id], lexicon)

        for term in terms[profile_id]:
            index[term].append(profile_id)

    pairs: dict[tuple[str, str], int] = {}
    limited_profiles = 0
    limited_buckets: set[str] = set()

    for profile_id in sorted(profiles):
        hits: Counter[str] = Counter()
        structural_terms = sorted(
            term
            for term in terms[profile_id]
            if term.startswith(("shape:", "branch:", "leaf:"))
        )
        other_terms = sorted(
            terms[profile_id] - set(structural_terms),
            key=lambda term: (len(index[term]), term),
        )
        selected_terms = structural_terms + other_terms

        if len(selected_terms) > config.max_index_terms:
            limited_profiles += 1

        for term in selected_terms[: config.max_index_terms]:
            bucket = index[term]

            if len(bucket) > config.max_bucket_size:
                limited_buckets.add(term)
                center = bisect_left(bucket, profile_id)
                start = max(
                    0,
                    min(
                        center - config.max_bucket_size // 2,
                        len(bucket) - config.max_bucket_size,
                    ),
                )
                bucket = bucket[start : start + config.max_bucket_size]

            weight = 4 if term.startswith(("word:", "sense:", "phrase:")) else 1

            for other in bucket:
                if other != profile_id:
                    hits[other] += weight

        ranked = sorted(hits, key=lambda other: (-hits[other], other))

        if len(ranked) > config.max_candidates_per_profile:
            limited_profiles += 1

        for other in ranked[: config.max_candidates_per_profile]:
            pair = (profile_id, other) if profile_id <= other else (other, profile_id)
            pairs[pair] = max(pairs.get(pair, 0), hits[other])

    diagnostics: list[str] = []

    if limited_profiles:
        diagnostics.append(f"candidate_profile_budget_reached:{limited_profiles}")

    if limited_buckets:
        diagnostics.append(f"candidate_bucket_budget_reached:{len(limited_buckets)}")

    selected = sorted(pairs, key=lambda pair: (-pairs[pair], pair))

    if len(selected) > config.max_pairs:
        diagnostics.append(
            f"candidate_pair_budget_reached:{len(selected)}>{config.max_pairs}"
        )

    bounded_pairs: list[tuple[str, str]] = []
    degrees: Counter[str] = Counter()

    for left, right in selected:
        if (
            degrees[left] >= config.max_candidates_per_profile
            or degrees[right] >= config.max_candidates_per_profile
        ):
            continue

        bounded_pairs.append((left, right))
        degrees[left] += 1
        degrees[right] += 1

        if len(bounded_pairs) >= config.max_pairs:
            break

    if len(bounded_pairs) < min(len(selected), config.max_pairs):
        diagnostics.append("candidate_degree_budget_reached")

    candidates = tuple(
        CandidatePair(left, right, compare_names(names[left], names[right], lexicon))
        for left, right in sorted(bounded_pairs)
    )

    return CandidateBatch(candidates, tuple(diagnostics))


def _index_terms(
    profile: NodeProfile,
    analyses: tuple[Segmentation, ...],
    lexicon: LexiconData,
) -> frozenset[str]:
    terms: set[str] = set()

    for analysis in analyses:
        for token in analysis.tokens:
            expanded = lexicon.abbreviations.get(token, (token,))

            for word in expanded:
                terms.add("word:" + word)
                terms.update(
                    "sense:" + sense for sense in lexicon.synonym_groups.get(word, ())
                )

        canonical = lexicon.phrase_aliases.get(analysis.tokens)

        if canonical:
            terms.add("phrase:" + " ".join(canonical))
            terms.update("word:" + word for word in canonical)

    normalized = "".join(
        character
        for character in profile.name.local_name.casefold()
        if character.isalnum()
    )
    terms.add("name:" + normalized)
    terms.update("gram:" + gram for gram in character_ngrams(normalized, 3))
    child_count = len(
        {
            child
            for variant in profile.child_sequences
            for child in variant.child_profile_ids
        }
    )
    kinds = ",".join(sorted({item.kind for item in profile.observations}))
    terms.add(f"shape:{child_count}:{kinds}")

    if child_count:
        terms.add(f"branch:{child_count // 3}")
    else:
        terms.add("leaf:" + kinds)

    return frozenset(terms)
