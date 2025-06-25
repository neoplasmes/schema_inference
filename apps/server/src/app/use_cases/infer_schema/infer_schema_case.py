import json
import math
from collections.abc import Sequence

from app.ports.tools import AssignmentTool, LexicalResourceTool
from app.use_cases.infer_schema import InferSchemaError
from core.entities import XmlNode
from core.entities.lexical import Segmentation, SegmentationConfig
from core.entities.matching import Correspondence, MatchingConfig
from core.entities.observations import ObservationLimits
from core.processes.build_hypotheses import build_hypotheses
from core.processes.build_probability_space import build_probability_space
from core.processes.observe_documents import ObserveDocumentsError, observe_documents
from core.processes.prepare_candidates import prepare_candidates
from core.processes.score_correspondences import (
    prepare_alignments,
    score_correspondences,
)
from core.processes.segment_identifier import segment_identifier


class InferSchema:
    """Build a reversible hypothesis space from immutable XML observations."""

    def __init__(
        self,
        *,
        lexical_resource: LexicalResourceTool,
        assignment: AssignmentTool,
        observation_limits: ObservationLimits | None = None,
        segmentation: SegmentationConfig | None = None,
        matching: MatchingConfig | None = None,
        max_rounds: int = 4,
        convergence_tolerance: float = 0.00001,
    ) -> None:
        if type(max_rounds) is not int or not 1 <= max_rounds <= 20:
            raise InferSchemaError("max_rounds must be an integer between 1 and 20.")

        if (
            type(convergence_tolerance) not in (int, float)
            or not math.isfinite(convergence_tolerance)
            or convergence_tolerance <= 0
        ):
            raise InferSchemaError("convergence_tolerance must be finite and positive.")

        self._lexical_resource = lexical_resource
        self._assignment = assignment
        self._observation_limits = observation_limits or ObservationLimits()
        self._segmentation = segmentation or SegmentationConfig()
        self._matching = matching or MatchingConfig()
        self._max_rounds = max_rounds
        self._convergence_tolerance = convergence_tolerance

    def execute(self, roots: list[XmlNode]) -> str:
        """Return deterministic JSON with empirical counts and heuristic scores."""
        try:
            corpus = observe_documents(roots, self._observation_limits)
        except ObserveDocumentsError as error:
            raise InferSchemaError(str(error)) from error

        if not corpus.profiles:
            return self._serialize(build_probability_space(corpus))

        lexicon = self._lexical_resource.load()
        by_name: dict[str, tuple[Segmentation, ...]] = {}

        for name in sorted({profile.name.local_name for profile in corpus.profiles}):
            by_name[name] = segment_identifier(name, lexicon, self._segmentation)

        analyses = {
            profile.profile_id: by_name[profile.name.local_name]
            for profile in corpus.profiles
        }
        candidates = prepare_candidates(corpus, lexicon, analyses, self._matching)
        correspondences: tuple[Correspondence, ...] = ()
        rounds = 0
        converged = not candidates.pairs

        for round_number in range(1, self._max_rounds + 1):
            if not candidates.pairs:
                break

            requests = prepare_alignments(
                corpus, candidates, correspondences, self._matching
            )
            alignments = self._assignment.assign(requests)
            current = score_correspondences(
                corpus,
                candidates,
                requests,
                alignments,
                correspondences,
                self._matching,
            )
            converged = self._converged(correspondences, current)
            correspondences = current
            rounds = round_number

            if converged:
                break

        hypotheses = build_hypotheses(corpus, correspondences, self._matching)
        warnings = [*lexicon.warnings, *candidates.diagnostics, *hypotheses.diagnostics]
        long_names = sum(
            len(name) > self._segmentation.max_identifier_length for name in by_name
        )

        if long_names:
            warnings.append(f"identifier_length_budget_reached:{long_names}")

        if not converged:
            warnings.append("context_iteration_limit_reached")

        if any(
            "child_alignment_truncated" in item.conflicts for item in correspondences
        ):
            warnings.append("child_alignment_truncated")

        space = build_probability_space(
            corpus,
            name_analyses=analyses,
            correspondences=[item.to_dict() for item in correspondences],
            equivalence_groups=hypotheses.groups,
            warnings=warnings,
            diagnostics={
                "lexical_sources": list(lexicon.sources),
                "candidate_pairs": len(candidates.pairs),
                "context_rounds": rounds,
                "context_converged": converged,
                "ambiguous_matches": [
                    {"profile": profile, "alternatives": list(alternatives)}
                    for profile, alternatives in hypotheses.ambiguities
                ],
            },
        )

        return self._serialize(space)

    def _converged(
        self,
        previous: Sequence[Correspondence],
        current: Sequence[Correspondence],
    ) -> bool:
        if len(previous) != len(current):
            return False

        return all(
            left.id == right.id
            and left.relation == right.relation
            and left.conflicts == right.conflicts
            and abs(left.score - right.score) < self._convergence_tolerance
            for left, right in zip(previous, current, strict=True)
        )

    @staticmethod
    def _serialize(space: dict) -> str:
        return json.dumps(space, ensure_ascii=False, sort_keys=True, allow_nan=False)
