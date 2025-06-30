import json
from collections.abc import Sequence
from dataclasses import replace
from itertools import permutations

import pytest

from app.use_cases.infer_schema import InferSchema, InferSchemaError
from core.entities import XmlNode
from core.entities.lexical import LexiconData
from core.entities.matching import (
    AdditionalPairEvidence,
    AlignmentRequest,
    AlignmentResult,
    Correspondence,
    MatchingConfig,
)
from core.entities.observations import ObservationLimits


class MemoryLexicalResource:
    def __init__(self):
        self.calls = 0

    def load(self) -> LexiconData:
        self.calls += 1

        return LexiconData(
            unigrams={"customer": 1000, "client": 1000, "id": 1000, "name": 1000},
            synonym_groups={
                "customer": frozenset({"party"}),
                "client": frozenset({"party"}),
            },
            warnings=("test_resource",),
        )


class ExhaustiveAssignment:
    def __init__(self):
        self.calls = 0

    def assign(
        self, requests: Sequence[AlignmentRequest]
    ) -> tuple[AlignmentResult, ...]:
        self.calls += 1
        results = []

        for request in requests:
            rows = len(request.left_slots)
            columns = len(request.right_slots)
            count = min(rows, columns)
            possibilities = (
                tuple(zip(left, right, strict=True))
                for left in permutations(range(rows), count)
                for right in permutations(range(columns), count)
            )
            pairs = max(
                possibilities,
                key=lambda pairs: sum(request.weights[i][j] for i, j in pairs),
                default=(),
            )
            results.append(AlignmentResult(request.request_id, pairs))

        return tuple(results)


def make_inference(**kwargs):
    resource = MemoryLexicalResource()
    assignment = ExhaustiveAssignment()

    return (
        InferSchema(lexical_resource=resource, assignment=assignment, **kwargs),
        resource,
        assignment,
    )


def test_empty_input_needs_no_external_resources():
    inference, resource, assignment = make_inference()
    space = json.loads(inference.execute([]))

    assert space["format"] == "xml-probability-space"
    assert space["statistics"] == {
        "documents": 0,
        "nodes": 0,
        "profiles": 0,
        "correspondences": 0,
    }
    assert resource.calls == assignment.calls == 0


def test_use_case_uses_resources_once_and_bounds_context_rounds():
    inference, resource, assignment = make_inference(max_rounds=2)
    first = XmlNode("customer", children=[XmlNode("name", "Ada")])
    second = XmlNode("client", children=[XmlNode("name", "Bob")])
    space = json.loads(inference.execute([first, second]))

    assert resource.calls == 1
    assert 1 <= assignment.calls <= 2
    assert space["diagnostics"]["context_rounds"] == assignment.calls
    assert "test_resource" in space["warnings"]
    assert space["statistics"]["nodes"] == 4
    assert space["correspondences"]
    assert first.tag == "customer"
    assert second.children[0].text == "Bob"


def test_input_order_does_not_change_json_or_scores():
    inference, _, _ = make_inference()
    first = XmlNode("customer", children=[XmlNode("id", "1")])
    second = XmlNode("client", children=[XmlNode("id", "2")])

    assert inference.execute([first, second]) == inference.execute([second, first])


def test_input_limit_is_reported_as_application_error_before_io():
    inference, resource, assignment = make_inference(
        observation_limits=ObservationLimits(max_documents=1)
    )

    with pytest.raises(InferSchemaError, match="max_documents"):
        inference.execute([XmlNode("a"), XmlNode("b")])

    assert resource.calls == assignment.calls == 0


def test_pair_budget_is_visible_in_result():
    inference, _, _ = make_inference(matching=MatchingConfig(max_pairs=1))
    roots = [XmlNode(name) for name in ("customer", "client", "name", "id")]
    space = json.loads(inference.execute(roots))

    assert len(space["correspondences"]) <= 1
    assert any("budget" in warning for warning in space["warnings"])


def test_optional_evidence_is_loaded_once_and_explained_in_json():
    class ExtraEvidence:
        def __init__(self):
            self.calls = 0

        def score(self, corpus, candidates):
            self.calls += 1

            return (AdditionalPairEvidence(candidates.pairs[0].id, "manual-tool", 0.9),)

    tool = ExtraEvidence()
    inference, _, assignment = make_inference(candidate_evidence=tool)
    first = XmlNode("customer", children=[XmlNode("name", "Ada")])
    second = XmlNode("client", children=[XmlNode("name", "Bob")])
    space = json.loads(inference.execute([first, second]))

    assert tool.calls == 1
    assert assignment.calls > 1
    assert space["diagnostics"]["additional_evidence_sources"] == ["manual-tool"]
    assert any(
        "external_weight" in item["features"] for item in space["correspondences"]
    )


def test_equal_total_score_does_not_hide_changed_context_anchors():
    inference, _, _ = make_inference()
    previous = Correspondence(
        id="pair",
        left="first",
        right="second",
        relation="related",
        score=0.8,
        features=(("context_anchors", 1.0), ("children", 0.8)),
        evidence=(),
        conflicts=(),
        choices=(),
    )
    current = replace(previous, features=(("context_anchors", 2.0), ("children", 0.8)))

    assert not inference._converged((previous,), (current,))
    assert inference._converged((current,), (current,))


@pytest.mark.parametrize("max_rounds", [0, 21, -1, 1.5, True])
def test_invalid_round_budget_is_rejected(max_rounds):
    with pytest.raises(InferSchemaError, match="max_rounds"):
        make_inference(max_rounds=max_rounds)


@pytest.mark.parametrize("tolerance", [0, -1, float("nan"), float("inf"), True, "0.1"])
def test_invalid_convergence_tolerance_is_rejected(tolerance):
    with pytest.raises(InferSchemaError, match="convergence_tolerance"):
        make_inference(convergence_tolerance=tolerance)
