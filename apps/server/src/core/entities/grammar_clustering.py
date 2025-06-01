from dataclasses import dataclass
from itertools import combinations
from typing import Literal


@dataclass(frozen=True)
class GrammarClustering:
    """Ordered grammar keys, condensed similarities and explicit grouping rules."""

    keys: tuple[str, ...]
    similarities: tuple[float, ...]
    threshold: float
    linkage: Literal["average"]

    @classmethod
    def from_pair_scores(
        cls,
        keys: tuple[str, ...],
        scores: dict[tuple[str, str], float],
        *,
        threshold: float,
        linkage: Literal["average"],
    ) -> "GrammarClustering":
        """Keep the legacy later-key-first comparison; excluded pairs score zero."""
        similarities = tuple(
            scores.get((second, first), 0.0) for first, second in combinations(keys, 2)
        )

        return cls(keys, similarities, threshold, linkage)
