from dataclasses import dataclass, field
from math import isfinite
from types import MappingProxyType
from typing import Mapping


@dataclass(frozen=True, eq=False)
class LexiconData:
    """Keep an immutable, versioned lexical snapshot independent of its loader."""

    unigrams: Mapping[str, float]
    bigrams: Mapping[tuple[str, str], float] = field(default_factory=dict)
    synonym_groups: Mapping[str, frozenset[str]] = field(default_factory=dict)
    phrase_aliases: Mapping[tuple[str, ...], tuple[str, ...]] = field(
        default_factory=dict
    )
    abbreviations: Mapping[str, tuple[str, ...]] = field(default_factory=dict)
    opposites: frozenset[tuple[str, str]] = frozenset()
    sources: tuple[str, ...] = ()
    warnings: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        unigrams = {
            word: float(count)
            for word, count in self.unigrams.items()
            if word and isfinite(count) and count > 0
        }
        bigrams = {
            pair: float(count)
            for pair, count in self.bigrams.items()
            if isfinite(count) and count > 0
        }

        object.__setattr__(self, "unigrams", MappingProxyType(unigrams))
        object.__setattr__(self, "bigrams", MappingProxyType(bigrams))
        object.__setattr__(
            self,
            "synonym_groups",
            MappingProxyType(
                {
                    word: frozenset(groups)
                    for word, groups in self.synonym_groups.items()
                }
            ),
        )
        object.__setattr__(
            self,
            "phrase_aliases",
            MappingProxyType(
                {
                    tuple(phrase): tuple(canonical)
                    for phrase, canonical in self.phrase_aliases.items()
                }
            ),
        )
        object.__setattr__(
            self,
            "abbreviations",
            MappingProxyType(
                {
                    word: tuple(expansion)
                    for word, expansion in self.abbreviations.items()
                }
            ),
        )
        object.__setattr__(
            self, "opposites", frozenset(tuple(sorted(pair)) for pair in self.opposites)
        )
        object.__setattr__(self, "sources", tuple(self.sources))
        object.__setattr__(self, "warnings", tuple(self.warnings))


@dataclass(frozen=True)
class SegmentationConfig:
    """Bound identifier analysis while retaining several competing explanations."""

    top_k: int = 5
    beam_width: int = 16
    max_identifier_length: int = 160
    max_tokens: int = 32
    max_word_length: int = 32
    max_typo_candidates: int = 24
    max_typo_visits: int = 3000
    typo_penalty: float = 5.0
    unknown_penalty: float = 18.0

    def __post_init__(self) -> None:
        limits = (
            self.top_k,
            self.beam_width,
            self.max_identifier_length,
            self.max_tokens,
            self.max_word_length,
            self.max_typo_candidates,
            self.max_typo_visits,
        )

        if any(type(value) is not int or value < 1 for value in limits):
            raise ValueError("Segmentation limits must be positive integers")

        if self.beam_width < self.top_k:
            raise ValueError("The beam must retain at least top_k candidates")

        penalties = (self.typo_penalty, self.unknown_penalty)

        if any(
            type(value) not in (int, float) or not isfinite(value) or value < 0
            for value in penalties
        ):
            raise ValueError(
                "Segmentation penalties must be finite nonnegative numbers"
            )


@dataclass(frozen=True)
class Segmentation:
    """Preserve source spelling alongside one scored boundary hypothesis."""

    original: str
    normalized: str
    tokens: tuple[str, ...]
    score: float
    unknown: tuple[str, ...] = ()
    corrections: tuple[tuple[str, str], ...] = ()


@dataclass(frozen=True)
class NameMatch:
    """Explain a heuristic lexical score and role conflicts without merging nodes."""

    score: float
    evidence: tuple[str, ...]
    conflicts: tuple[str, ...]
    left: Segmentation
    right: Segmentation
