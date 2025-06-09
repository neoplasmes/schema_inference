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
