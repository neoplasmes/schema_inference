from typing import Protocol

from core.entities.matching import AdditionalPairEvidence, CandidateBatch
from core.entities.observations import ObservedCorpus


class CandidateEvidenceTool(Protocol):
    def score(
        self,
        corpus: ObservedCorpus,
        candidates: CandidateBatch,
    ) -> tuple[AdditionalPairEvidence, ...]: ...
