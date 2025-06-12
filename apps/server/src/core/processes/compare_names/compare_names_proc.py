from functools import lru_cache

from core.entities.lexical import (
    LexiconData,
    NameMatch,
    Segmentation,
    SegmentationConfig,
)
from core.processes.segment_identifier import segment_identifier

_DEFAULT_CONFIG = SegmentationConfig()


def character_ngrams(word: str, n: int = 3) -> frozenset[str]:
    """Extract contiguous character fragments without interpreting their meaning."""

    if n < 1:
        raise ValueError("N-gram length must be positive")

    return frozenset(word[index : index + n] for index in range(len(word) - n + 1))


def _edit_distance(first: str, second: str) -> int:
    rows = [list(range(len(second) + 1))]

    for row, first_character in enumerate(first, 1):
        current = [row]

        for column, second_character in enumerate(second, 1):
            distance = min(
                current[column - 1] + 1,
                rows[-1][column] + 1,
                rows[-1][column - 1] + (first_character != second_character),
            )

            if (
                row > 1
                and column > 1
                and first_character == second[column - 2]
                and first[row - 2] == second_character
            ):
                distance = min(distance, rows[-2][column - 2] + 1)

            current.append(distance)

        rows.append(current)

    return rows[-1][-1]


def _canonical(tokens: tuple[str, ...], lexicon: LexiconData) -> tuple[str, ...]:
    expanded = tuple(
        token
        for source in tokens
        for token in lexicon.abbreviations.get(source, (source,))
    )
    result = []
    position = 0
    max_phrase = max((len(phrase) for phrase in lexicon.phrase_aliases), default=1)

    while position < len(expanded):
        for size in range(min(max_phrase, len(expanded) - position), 0, -1):
            phrase = expanded[position : position + size]
            canonical = lexicon.phrase_aliases.get(phrase)

            if canonical is not None:
                result.extend(canonical)
                position += size

                break
        else:
            result.append(expanded[position])
            position += 1

    return tuple(result)


def _forms(word: str, lexicon: LexiconData) -> frozenset[str]:
    candidates = {word}

    if len(word) > 4 and word.endswith("ies"):
        candidates.add(word[:-3] + "y")

    if len(word) > 3 and word.endswith("s") and not word.endswith(("ss", "us", "is")):
        candidates.add(word[:-1])

    if len(word) > 5 and word.endswith("ing"):
        candidates.update((word[:-3], word[:-3] + "e"))

    return frozenset(
        candidate for candidate in candidates if candidate in lexicon.unigrams
    ) | {word}


@lru_cache(maxsize=32768)
def _role_keys(word: str, lexicon: LexiconData) -> frozenset[str]:
    forms = _forms(word, lexicon)
    groups = {
        group
        for form in forms
        for group in lexicon.synonym_groups.get(form, ())
        if group.startswith("curated:")
    }

    return forms | groups


@lru_cache(maxsize=4)
def _opposition_index(lexicon: LexiconData) -> dict[str, frozenset[str]]:
    oppositions: dict[str, set[str]] = {}

    for first, second in lexicon.opposites:
        left = _role_keys(first, lexicon)
        right = _role_keys(second, lexicon)

        for key in left:
            oppositions.setdefault(key, set()).update(right)

        for key in right:
            oppositions.setdefault(key, set()).update(left)

    return {key: frozenset(values) for key, values in oppositions.items()}


def _opposed(first: str, second: str, lexicon: LexiconData) -> bool:
    index = _opposition_index(lexicon)
    right = _role_keys(second, lexicon)

    return any(
        index.get(key, frozenset()) & right for key in _role_keys(first, lexicon)
    )


@lru_cache(maxsize=65536)
def _relation(first: str, second: str, lexicon: LexiconData) -> tuple[float, str]:
    if first == second:
        return 1.0, "same_token"

    if _opposed(first, second, lexicon):
        return 0.0, "opposed_roles"

    first_forms = _forms(first, lexicon)
    second_forms = _forms(second, lexicon)

    if first_forms & second_forms:
        return 0.93, "inflection"

    first_groups = set().union(
        *(lexicon.synonym_groups.get(word, ()) for word in first_forms)
    )
    second_groups = set().union(
        *(lexicon.synonym_groups.get(word, ()) for word in second_forms)
    )
    groups = first_groups & second_groups

    if groups:
        if any(group.startswith("curated:") for group in groups):
            return 0.94, "curated_synonym"

        return 0.86, "shared_wordnet_sense"

    if min(len(first), len(second)) < 4 or first.isdigit() or second.isdigit():
        return 0.0, "different_tokens"

    overlap = 0.0

    for n in (2, 3):
        left = character_ngrams(first, n)
        right = character_ngrams(second, n)

        if left and right:
            overlap += len(left & right) / (len(left) + len(right))

    distance = _edit_distance(first, second)

    if distance == 1:
        return 0.87, "single_edit"

    if distance == 2 and min(len(first), len(second)) >= 8:
        return 0.76, "two_edits"

    return min(0.4, overlap * 0.4), "character_ngrams"


def _assignment(matrix: list[list[float]]) -> tuple[tuple[int, int], ...]:
    if not matrix or not matrix[0]:
        return ()

    row_count = len(matrix)
    column_count = len(matrix[0])
    size = max(row_count, column_count)
    row_potential = [0.0] * (size + 1)
    column_potential = [0.0] * (size + 1)
    matched_row = [0] * (size + 1)
    predecessor = [0] * (size + 1)

    for row in range(1, size + 1):
        matched_row[0] = row
        current_column = 0
        minimum = [float("inf")] * (size + 1)
        used = [False] * (size + 1)

        while True:
            used[current_column] = True
            current_row = matched_row[current_column]
            delta = float("inf")
            next_column = 0

            for column in range(1, size + 1):
                if used[column]:
                    continue

                weight = (
                    matrix[current_row - 1][column - 1]
                    if current_row <= row_count and column <= column_count
                    else 0.0
                )
                cost = (
                    1.0 - weight - row_potential[current_row] - column_potential[column]
                )

                if cost < minimum[column]:
                    minimum[column] = cost
                    predecessor[column] = current_column

                if minimum[column] < delta:
                    delta = minimum[column]
                    next_column = column

            for column in range(size + 1):
                if used[column]:
                    row_potential[matched_row[column]] += delta
                    column_potential[column] -= delta
                else:
                    minimum[column] -= delta

            current_column = next_column

            if matched_row[current_column] == 0:
                break

        while current_column:
            previous_column = predecessor[current_column]
            matched_row[current_column] = matched_row[previous_column]
            current_column = previous_column

    return tuple(
        (matched_row[column] - 1, column - 1)
        for column in range(1, column_count + 1)
        if 0 < matched_row[column] <= row_count
    )


def _conflicts(
    left: Segmentation, right: Segmentation, lexicon: LexiconData
) -> tuple[str, ...]:
    return tuple(
        sorted(
            {
                "role_conflict:" + "/".join(sorted((first, second)))
                for first in _canonical(left.tokens, lexicon)
                for second in _canonical(right.tokens, lexicon)
                if _opposed(first, second, lexicon)
            }
        )
    )


def _compare_pair(
    left: Segmentation, right: Segmentation, lexicon: LexiconData
) -> tuple[float, tuple[str, ...]]:
    first = _canonical(left.tokens, lexicon)
    second = _canonical(right.tokens, lexicon)

    if not first or not second:
        return 0.0, ("empty_name",)

    relations = [[_relation(a, b, lexicon) for b in second] for a in first]
    assignments = _assignment([[score for score, _ in row] for row in relations])
    matched = [
        (row, column) for row, column in assignments if relations[row][column][0] > 0
    ]
    score = sum(relations[row][column][0] for row, column in matched) / max(
        len(first), len(second)
    )
    evidence = {
        relations[row][column][1] + ":" + first[row] + "/" + second[column]
        for row, column in matched
    }

    if left.tokens != first or right.tokens != second:
        evidence.add("phrase_or_abbreviation_expansion")

    phrase_groups = lexicon.synonym_groups.get(
        " ".join(first), frozenset()
    ) & lexicon.synonym_groups.get(" ".join(second), frozenset())

    if phrase_groups and score < 0.86:
        score = 0.86
        evidence.add("shared_wordnet_phrase_sense")

    if len(matched) < max(len(first), len(second)):
        evidence.add("unmatched_tokens")

    if left.corrections or right.corrections:
        evidence.add("segmentation_typo_correction")
        score *= 0.93

    if left.unknown or right.unknown:
        evidence.add("unknown_fragments")

    return score, tuple(sorted(evidence))


@lru_cache(maxsize=16384)
def compare_names(
    left: str | tuple[Segmentation, ...],
    right: str | tuple[Segmentation, ...],
    lexicon: LexiconData,
    config: SegmentationConfig = _DEFAULT_CONFIG,
) -> NameMatch:
    """Compare alternative boundaries with one-to-one coverage and role vetoes."""

    left_options = (
        segment_identifier(left, lexicon, config) if isinstance(left, str) else left
    )
    right_options = (
        segment_identifier(right, lexicon, config) if isinstance(right, str) else right
    )

    if not left_options or not right_options:
        raise ValueError("Both names need at least one segmentation")

    if (
        left_options[0].normalized == right_options[0].normalized
        and left_options[0].normalized
    ):
        return NameMatch(
            1.0, ("same_normalized_name",), (), left_options[0], right_options[0]
        )

    conflicts = _conflicts(left_options[0], right_options[0], lexicon)
    best: NameMatch | None = None

    for first in left_options:
        for second in right_options:
            score, evidence = _compare_pair(first, second, lexicon)
            penalty = 0.015 * (
                max(0.0, left_options[0].score - first.score)
                + max(0.0, right_options[0].score - second.score)
            )
            score = max(0.0, score - min(0.25, penalty))
            pair_conflicts = tuple(
                sorted(set(conflicts) | set(_conflicts(first, second, lexicon)))
            )

            if pair_conflicts:
                score = min(score, 0.25)

            candidate = NameMatch(
                round(score, 6), evidence, pair_conflicts, first, second
            )

            if best is None or candidate.score > best.score:
                best = candidate

    assert best is not None

    return best
