import re
import unicodedata
from array import array
from dataclasses import dataclass
from functools import lru_cache
from math import log

from core.entities.lexical import LexiconData, Segmentation, SegmentationConfig

_DEFAULT_CONFIG = SegmentationConfig()


@dataclass(frozen=True)
class _Path:
    tokens: tuple[str, ...] = ()
    score: float = 0.0
    unknown: tuple[str, ...] = ()
    corrections: tuple[tuple[str, str], ...] = ()


@dataclass(frozen=True)
class _Candidate:
    end: int
    word: str
    edited: bool = False
    unknown: bool = False


@dataclass(frozen=True)
class _Index:
    first_child: array
    next_sibling: array
    letters: str
    terminal: tuple[str | None, ...]
    total: float


@lru_cache(maxsize=4)
def _index(lexicon: LexiconData, max_word_length: int) -> _Index:
    first_child = array("i", [-1])
    next_sibling = array("i", [-1])
    last_child = array("i", [-1])
    letters = ["\0"]
    terminal: list[str | None] = [None]
    path = [0]
    previous = ""

    for word in sorted(lexicon.unigrams):
        if not word.isalpha() or len(word) > max_word_length:
            continue

        common = 0

        while (
            common < min(len(word), len(previous)) and word[common] == previous[common]
        ):
            common += 1

        path = path[: common + 1]

        for character in word[common:]:
            parent = path[-1]
            node = len(terminal)

            if first_child[parent] < 0:
                first_child[parent] = node
            else:
                next_sibling[last_child[parent]] = node

            last_child[parent] = node
            first_child.append(-1)
            next_sibling.append(-1)
            last_child.append(-1)
            letters.append(character)
            terminal.append(None)
            path.append(node)

        terminal[path[-1]] = word
        previous = word

    return _Index(
        first_child,
        next_sibling,
        "".join(letters),
        tuple(terminal),
        max(sum(lexicon.unigrams.values()), 1.0),
    )


def _children(index: _Index, node: int) -> list[int]:
    result = []
    child = index.first_child[node]

    while child >= 0:
        result.append(child)
        child = index.next_sibling[child]

    return result


def _chunks(name: str) -> tuple[str, ...]:
    local_name = name.rsplit("}", 1)[-1] if name.startswith("{") else name
    local_name = local_name.rsplit(":", 1)[-1]
    separated = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1 \2", local_name)
    separated = re.sub(r"([a-z])([A-Z])", r"\1 \2", separated)
    separated = re.sub(r"(?<=\d)(?=[^\W\d_])|(?<=[^\W\d_])(?=\d)", " ", separated)

    return tuple(
        token.casefold()
        for token in re.findall(r"[^\W_]+", unicodedata.normalize("NFC", separated))
    )


def _exact_candidates(
    text: str, start: int, index: _Index, limit: int
) -> list[_Candidate]:
    node = 0
    candidates = []

    for position in range(start, min(len(text), start + limit)):
        child = index.first_child[node]

        while child >= 0 and index.letters[child] != text[position]:
            child = index.next_sibling[child]

        if child < 0:
            break

        node = child
        word = index.terminal[node]

        if word is not None:
            candidates.append(_Candidate(position + 1, word))

    return candidates


def _typo_candidates(
    text: str,
    start: int,
    index: _Index,
    lexicon: LexiconData,
    config: SegmentationConfig,
) -> list[_Candidate]:
    suffix = text[start : start + config.max_word_length + 1]

    if len(suffix) < 4:
        return []

    first = tuple(range(len(suffix) + 1))
    stack: list[tuple[int, str, tuple[int, ...], tuple[int, ...] | None, str]] = [
        (0, "", first, None, "")
    ]
    candidates: dict[tuple[int, str], _Candidate] = {}
    visits = 0

    while stack and visits < config.max_typo_visits:
        node, prefix, previous, before_previous, previous_character = stack.pop()

        for child in reversed(_children(index, node)):
            character = index.letters[child]
            visits += 1
            current = [len(prefix) + 1]

            for column, source_character in enumerate(suffix, 1):
                distance = min(
                    current[column - 1] + 1,
                    previous[column] + 1,
                    previous[column - 1] + (character != source_character),
                )

                if (
                    before_previous is not None
                    and column > 1
                    and character == suffix[column - 2]
                    and previous_character == source_character
                ):
                    distance = min(distance, before_previous[column - 2] + 1)

                current.append(distance)

            word = index.terminal[child]

            if word is not None and len(word) >= 4:
                for consumed in range(
                    max(4, len(word) - 1), min(len(suffix), len(word) + 1) + 1
                ):
                    if current[consumed] == 1:
                        candidate = _Candidate(start + consumed, word, edited=True)
                        candidates[(candidate.end, word)] = candidate

            if min(current) <= 1 and len(prefix) + 1 < config.max_word_length:
                stack.append(
                    (child, prefix + character, tuple(current), previous, character)
                )

            if visits >= config.max_typo_visits:
                break

    ranked = sorted(
        candidates.values(),
        key=lambda candidate: (
            -lexicon.unigrams.get(candidate.word, 0),
            candidate.word,
            candidate.end,
        ),
    )

    return ranked[: config.max_typo_candidates]


def _transition(
    previous: str | None, word: str, lexicon: LexiconData, index: _Index
) -> float:
    count = lexicon.unigrams.get(word, 1.0)
    unigram = log(count / index.total)

    if previous is None:
        return unigram

    bigram = lexicon.bigrams.get((previous, word), 0.0)

    if not bigram:
        return unigram

    conditional = min(bigram / max(lexicon.unigrams.get(previous, 1.0), bigram), 1.0)

    return 0.7 * log(max(conditional, 1 / index.total)) + 0.3 * unigram


def _prune(paths: list[_Path], width: int) -> list[_Path]:
    distinct: dict[tuple[str, ...], _Path] = {}

    for path in paths:
        existing = distinct.get(path.tokens)

        if existing is None or path.score > existing.score:
            distinct[path.tokens] = path

    return sorted(distinct.values(), key=lambda path: (-path.score, path.tokens))[
        :width
    ]


def _segment_chunk(
    text: str,
    incoming: list[_Path],
    lexicon: LexiconData,
    index: _Index,
    config: SegmentationConfig,
) -> list[_Path]:
    if text.isdigit():
        return [
            _Path(path.tokens + (text,), path.score - 3, path.unknown, path.corrections)
            for path in incoming
        ]

    positions: list[list[_Path]] = [[] for _ in range(len(text) + 1)]
    positions[0] = incoming
    exact = {
        start: _exact_candidates(text, start, index, config.max_word_length)
        for start in range(len(text))
    }

    for start in range(len(text)):
        paths = _prune(positions[start], config.beam_width)

        if not paths:
            continue

        candidates = list(exact[start])
        candidates.extend(_typo_candidates(text, start, index, lexicon, config))
        unknown_ends = [len(text)]
        unknown_ends.extend(
            end
            for end in range(start + 1, len(text))
            if any(len(candidate.word) >= 3 for candidate in exact[end])
        )

        for end in unknown_ends[: config.beam_width]:
            candidates.append(_Candidate(end, text[start:end], unknown=True))

        for path in paths:
            previous = path.tokens[-1] if path.tokens else None

            for candidate in candidates:
                original = text[start : candidate.end]
                unknown = path.unknown
                corrections = path.corrections

                if candidate.unknown:
                    score = -config.unknown_penalty - len(original) * 0.9
                    unknown += (original,)
                else:
                    score = _transition(previous, candidate.word, lexicon, index)

                if candidate.edited:
                    score -= config.typo_penalty
                    corrections += ((original, candidate.word),)

                positions[candidate.end].append(
                    _Path(
                        path.tokens + (candidate.word,),
                        path.score + score,
                        unknown,
                        corrections,
                    )
                )

                if len(positions[candidate.end]) > config.beam_width * 6:
                    positions[candidate.end] = _prune(
                        positions[candidate.end], config.beam_width
                    )

    return _prune(positions[-1], config.beam_width)


@lru_cache(maxsize=4096)
def segment_identifier(
    name: str,
    lexicon: LexiconData,
    config: SegmentationConfig = _DEFAULT_CONFIG,
) -> tuple[Segmentation, ...]:
    """Find bounded top-k trie paths, including typo and unknown-fragment paths."""

    chunks = _chunks(name)
    normalized = "".join(chunks)

    if not chunks or len(normalized) > config.max_identifier_length:
        return (
            Segmentation(name, normalized, chunks, -config.unknown_penalty, chunks),
        )

    index = _index(lexicon, config.max_word_length)
    paths = [_Path()]

    for chunk in chunks:
        paths = _segment_chunk(chunk, paths, lexicon, index, config)

    chosen = _prune(paths, config.top_k)
    source_tokens = chunks

    if not any(path.tokens == source_tokens for path in chosen):
        source_unknown = tuple(
            word
            for word in source_tokens
            if word not in lexicon.unigrams and not word.isdigit()
        )
        source = _Path(
            source_tokens, min(path.score for path in chosen) - 1, source_unknown
        )
        chosen = (
            chosen[: max(config.top_k - 1, 0)] + [source]
            if config.top_k > 1
            else chosen
        )

    return tuple(
        Segmentation(
            name, normalized, path.tokens, path.score, path.unknown, path.corrections
        )
        for path in chosen
    )
