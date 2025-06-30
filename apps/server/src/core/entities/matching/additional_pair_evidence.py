from dataclasses import dataclass


@dataclass(frozen=True)
class AdditionalPairEvidence:
    candidate_id: str
    source: str
    score: float
    weight: float = 0.1
