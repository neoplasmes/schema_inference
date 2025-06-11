import math
import re
from collections import Counter
from collections.abc import Sequence

from core.entities.lexical import LexiconData


def _words(name: str, lexicon: LexiconData) -> tuple[str, ...]:
    separated = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", name)
    chunks = re.findall(r"[a-z0-9]+", separated.lower())
    words: list[str] = []

    for chunk in chunks:
        if chunk in lexicon.abbreviations:
            words.extend(lexicon.abbreviations[chunk])

            continue

        if chunk in lexicon.unigrams or len(chunk) > 80:
            words.append(chunk)

            continue

        paths: dict[int, tuple[float, tuple[str, ...]]] = {0: (0.0, ())}

        for end in range(1, len(chunk) + 1):
            candidates = []

            for start in range(max(0, end - 32), end):
                word = chunk[start:end]

                if start in paths and word in lexicon.unigrams and len(word) > 1:
                    score, prefix = paths[start]
                    candidates.append(
                        (
                            score + math.log1p(lexicon.unigrams[word]) - 18,
                            (*prefix, word),
                        )
                    )

            if candidates:
                paths[end] = max(candidates)

        words.extend(paths.get(len(chunk), (0, (chunk,)))[1])

    tokens = tuple(words)

    return lexicon.phrase_aliases.get(tokens, tokens)


def _one_edit(left: str, right: str) -> bool:
    if abs(len(left) - len(right)) > 1 or min(len(left), len(right)) < 4:
        return False

    if len(left) == len(right):
        different = [index for index in range(len(left)) if left[index] != right[index]]

        return len(different) == 1 or (
            len(different) == 2
            and different[1] == different[0] + 1
            and left[different[0]] == right[different[1]]
            and left[different[1]] == right[different[0]]
        )

    short, long = sorted((left, right), key=len)

    return any(long[:index] + long[index + 1 :] == short for index in range(len(long)))


def match_field_names(
    contexts: Sequence[Sequence[str]], lexicon: LexiconData, max_names: int = 256
) -> dict[str, tuple[str, str]]:
    """Merge unambiguous spellings and dictionary aliases within one parent role."""
    counts = Counter(name for names in contexts for name in names)
    names = sorted(counts)
    result = {name: (name, "original") for name in names}

    if len(names) > max_names:
        return result

    occurrences = {
        name: {index for index, context in enumerate(contexts) if name in context}
        for name in names
    }
    tokens = {name: _words(name.rsplit("}", 1)[-1], lexicon) for name in names}

    def relation(left: str, right: str) -> str | None:
        if left == right:
            return "original"

        if occurrences[left] & occurrences[right]:
            return None

        if left.rpartition("}")[0] != right.rpartition("}")[0]:
            return None

        first, second = tokens[left], tokens[right]

        if any(
            tuple(sorted((a, b))) in lexicon.opposites for a in first for b in second
        ):
            return None

        if first == second and first:
            return "alias"

        if (
            len(first) == len(second)
            and first
            and all(
                a == b
                or bool(
                    lexicon.synonym_groups.get(a, frozenset())
                    & lexicon.synonym_groups.get(b, frozenset())
                )
                for a, b in zip(first, second, strict=True)
            )
        ):
            return "alias"

        a, b = " ".join(first), " ".join(second)

        if lexicon.synonym_groups.get(a, frozenset()) & lexicon.synonym_groups.get(
            b, frozenset()
        ):
            return "alias"

        if (
            ((a in lexicon.unigrams) != (b in lexicon.unigrams))
            or (
                max(lexicon.unigrams.get(a, 0), lexicon.unigrams.get(b, 0))
                >= 100
                * max(1, min(lexicon.unigrams.get(a, 0), lexicon.unigrams.get(b, 0)))
                and not (
                    lexicon.synonym_groups.get(a) and lexicon.synonym_groups.get(b)
                )
            )
        ) and _one_edit(a, b):
            return "typo"

        return None

    compatible = {
        name: [other for other in names if other != name and relation(name, other)]
        for name in names
    }
    ambiguous = {
        name
        for name, matches in compatible.items()
        if any(not relation(a, b) for a in matches for b in matches if a != b)
    }
    assigned: set[str] = set()
    priority = sorted(
        names,
        key=lambda name: (
            -int(bool(lexicon.synonym_groups.get(" ".join(tokens[name])))),
            -int(" ".join(tokens[name]) in lexicon.unigrams),
            -counts[name],
            -lexicon.unigrams.get(" ".join(tokens[name]), 0),
            name,
        ),
    )

    for canonical in priority:
        if canonical in assigned or canonical in ambiguous:
            continue

        group = [canonical]
        assigned.add(canonical)

        for name in priority:
            if name in assigned or name in ambiguous:
                continue

            if all(relation(member, name) for member in group):
                result[name] = (canonical, relation(canonical, name) or "alias")
                group.append(name)
                assigned.add(name)

    return result
