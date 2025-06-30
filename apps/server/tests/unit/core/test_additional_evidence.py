from dataclasses import replace

import pytest

from core.entities import XmlNode
from core.entities.lexical import LexiconData
from core.entities.matching import AdditionalPairEvidence, AlignmentResult
from core.processes.observe_documents import observe_documents
from core.processes.prepare_candidates import prepare_candidates
from core.processes.score_correspondences import (
    ScoreCorrespondencesError,
    prepare_alignments,
    score_correspondences,
)


def _inputs(opposed=False):
    names = ("billingaddress", "shippingaddress") if opposed else ("customer", "client")
    corpus = observe_documents([XmlNode(name, "value") for name in names])
    lexicon = LexiconData(
        unigrams={
            word: 100
            for word in ("customer", "client", "billing", "shipping", "address")
        },
        synonym_groups={
            "customer": frozenset({"curated:person"}),
            "client": frozenset({"curated:person"}),
        },
        opposites=frozenset({("billing", "shipping")}),
    )
    candidates = prepare_candidates(corpus, lexicon)
    requests = prepare_alignments(corpus, candidates)
    results = tuple(AlignmentResult(request.request_id, ()) for request in requests)

    return corpus, candidates, requests, results


def test_all_external_sources_share_a_ten_percent_influence_budget():
    corpus, candidates, requests, results = _inputs()
    baseline = score_correspondences(corpus, candidates, requests, results)[0]
    evidence = (
        AdditionalPairEvidence(baseline.id, "first", 1.0),
        AdditionalPairEvidence(baseline.id, "second", 0.0),
    )
    enhanced = score_correspondences(
        corpus, candidates, requests, results, extra_evidence=evidence
    )[0]

    assert enhanced.score == pytest.approx(baseline.score * 0.9 + 0.5 * 0.1, abs=1e-6)
    assert dict(enhanced.features)["external_weight"] == 0.1
    assert "additional_evidence:first" in enhanced.evidence
    assert "additional_evidence:second" in enhanced.evidence


def test_external_evidence_cannot_override_role_conflicts():
    corpus, candidates, requests, results = _inputs(opposed=True)
    baseline = score_correspondences(corpus, candidates, requests, results)[0]
    enhanced = score_correspondences(
        corpus,
        candidates,
        requests,
        results,
        extra_evidence=(AdditionalPairEvidence(baseline.id, "overconfident", 1.0),),
    )[0]

    assert enhanced.relation != "equivalent"
    assert enhanced.conflicts == baseline.conflicts
    assert any("role_conflict" in conflict for conflict in enhanced.conflicts)


@pytest.mark.parametrize(
    "changes",
    [
        {"candidate_id": "unknown"},
        {"score": float("nan")},
        {"score": float("inf")},
        {"score": -0.1},
        {"score": 1.1},
        {"weight": float("nan")},
        {"weight": 0.11},
        {"weight": -0.1},
        {"weight": True},
        {"source": " "},
    ],
)
def test_rejects_malformed_additional_evidence(changes):
    corpus, candidates, requests, results = _inputs()
    evidence = replace(
        AdditionalPairEvidence(candidates.pairs[0].id, "source", 0.5), **changes
    )

    with pytest.raises(ScoreCorrespondencesError):
        score_correspondences(
            corpus, candidates, requests, results, extra_evidence=(evidence,)
        )


def test_rejects_duplicate_scores_from_the_same_source():
    corpus, candidates, requests, results = _inputs()
    evidence = AdditionalPairEvidence(candidates.pairs[0].id, "source", 0.5)

    with pytest.raises(ScoreCorrespondencesError, match="at most one"):
        score_correspondences(
            corpus, candidates, requests, results, extra_evidence=(evidence, evidence)
        )


def test_disabled_external_evidence_does_not_change_the_result():
    corpus, candidates, requests, results = _inputs()
    baseline = score_correspondences(corpus, candidates, requests, results)
    evidence = AdditionalPairEvidence(
        candidates.pairs[0].id, "disabled", 0.0, weight=0.0
    )

    assert (
        score_correspondences(
            corpus, candidates, requests, results, extra_evidence=(evidence,)
        )
        == baseline
    )


def test_external_source_order_does_not_change_the_result():
    corpus, candidates, requests, results = _inputs()
    evidence = (
        AdditionalPairEvidence(candidates.pairs[0].id, "first", 0.3, 0.04),
        AdditionalPairEvidence(candidates.pairs[0].id, "second", 0.9, 0.03),
    )

    assert score_correspondences(
        corpus, candidates, requests, results, extra_evidence=evidence
    ) == score_correspondences(
        corpus, candidates, requests, results, extra_evidence=evidence[::-1]
    )
