import hashlib
from dataclasses import dataclass
from typing import Literal

from core.entities.lexical import NameMatch


@dataclass(frozen=True)
class MatchingConfig:
    max_pairs: int = 20_000
    max_candidates_per_profile: int = 32
    max_bucket_size: int = 128
    max_index_terms: int = 48
    max_child_slots: int = 128
    equivalence_threshold: float = 0.82
    ambiguity_margin: float = 0.04

    def __post_init__(self) -> None:
        limits = (
            self.max_pairs,
            self.max_candidates_per_profile,
            self.max_bucket_size,
            self.max_index_terms,
            self.max_child_slots,
        )

        if any(type(value) is not int or value < 1 for value in limits):
            raise ValueError("Matching limits must be positive integers.")

        if (
            not 0 <= self.equivalence_threshold <= 1
            or not 0 <= self.ambiguity_margin <= 1
        ):
            raise ValueError("Matching thresholds must lie between zero and one.")


@dataclass(frozen=True)
class CandidatePair:
    left: str
    right: str
    name_match: NameMatch

    @property
    def id(self) -> str:
        encoded = "\0".join(sorted((self.left, self.right))).encode("utf-8")

        return "correspondence_" + hashlib.sha256(encoded).hexdigest()


@dataclass(frozen=True)
class CandidateBatch:
    pairs: tuple[CandidatePair, ...]
    diagnostics: tuple[str, ...] = ()


@dataclass(frozen=True)
class AlignmentRequest:
    request_id: str
    weights: tuple[tuple[float, ...], ...]
    left_slots: tuple[str, ...]
    right_slots: tuple[str, ...]
    left_total: int = 0
    right_total: int = 0
    truncated: bool = False


@dataclass(frozen=True)
class AlignmentResult:
    request_id: str
    pairs: tuple[tuple[int, int], ...]


@dataclass(frozen=True)
class Correspondence:
    id: str
    left: str
    right: str
    relation: Literal["equivalent", "shared_structure", "related", "uncertain"]
    score: float
    features: tuple[tuple[str, float], ...]
    evidence: tuple[str, ...]
    conflicts: tuple[str, ...]
    choices: tuple[tuple[str, tuple[str, ...]], ...]

    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "left": self.left,
            "right": self.right,
            "relation": self.relation,
            "score": self.score,
            "features": dict(self.features),
            "evidence": list(self.evidence),
            "conflicts": list(self.conflicts),
            "choices": {side: list(tokens) for side, tokens in self.choices},
        }


@dataclass(frozen=True)
class HypothesisSpace:
    groups: tuple[tuple[str, ...], ...]
    ambiguities: tuple[tuple[str, tuple[str, ...]], ...] = ()
    diagnostics: tuple[str, ...] = ()
