from dataclasses import replace
from itertools import permutations

import pytest

from core.entities import XmlNode
from core.entities.lexical import LexiconData
from core.entities.matching import AlignmentResult, Correspondence, MatchingConfig
from core.entities.observations import ObservedCorpus
from core.processes.observe_documents import observe_documents
from core.processes.prepare_candidates import prepare_candidates
from core.processes.score_correspondences import (
    ScoreCorrespondencesError,
    prepare_alignments,
    score_correspondences,
)


def _lexicon():
    groups = [
        ("customer", "client"),
        ("billing", "invoice"),
        ("address", "location"),
        ("street", "road"),
        ("postcode", "zipcode"),
        ("shipping", "delivery"),
    ]
    unigrams = {word: 100 for group in groups for word in group}
    unigrams.update({"root": 100, "person": 100, "name": 100})

    return LexiconData(
        unigrams=unigrams,
        synonym_groups={
            word: frozenset({f"curated:{group[0]}"})
            for group in groups
            for word in group
        },
        opposites=frozenset({("billing", "shipping")}),
    )


def _solve(requests):
    results = []

    for request in requests:
        size = min(len(request.left_slots), len(request.right_slots))
        options = (
            tuple(zip(rows, columns, strict=True))
            for rows in permutations(range(len(request.left_slots)), size)
            for columns in permutations(range(len(request.right_slots)), size)
        )
        pairs = max(
            options,
            key=lambda pairs: sum(
                request.weights[row][column] for row, column in pairs
            ),
            default=(),
        )
        results.append(AlignmentResult(request.request_id, pairs))

    return tuple(results)


def _score(
    roots, config=None
) -> tuple[ObservedCorpus, tuple[Correspondence, ...], dict[str, str]]:
    config = config or MatchingConfig()
    corpus = observe_documents(roots)
    candidates = prepare_candidates(corpus, _lexicon(), config=config)
    previous: tuple[Correspondence, ...] = ()

    for _ in range(3):
        requests = prepare_alignments(corpus, candidates, previous, config)
        previous = score_correspondences(
            corpus, candidates, requests, _solve(requests), previous, config
        )

    names = {profile.profile_id: profile.name.local_name for profile in corpus.profiles}

    return corpus, previous, names


def test_matches_completely_renamed_lowercase_compound_structures():
    roots = [
        XmlNode(
            "customer",
            children=[
                XmlNode(
                    "billingaddress",
                    children=[XmlNode("street", "Main"), XmlNode("postcode", "001")],
                )
            ],
        ),
        XmlNode(
            "client",
            children=[
                XmlNode(
                    "invoicelocation",
                    children=[XmlNode("road", "Main"), XmlNode("zipcode", "001")],
                )
            ],
        ),
    ]
    _, scored, names = _score(roots)
    expected = [
        {"customer", "client"},
        {"billingaddress", "invoicelocation"},
        {"street", "road"},
        {"postcode", "zipcode"},
    ]

    for pair in expected:
        correspondence = next(
            item for item in scored if {names[item.left], names[item.right]} == pair
        )

        assert correspondence.relation == "equivalent"
        assert correspondence.score >= 0.82
        assert not correspondence.conflicts


def test_preserves_distinct_billing_and_shipping_roles_and_their_children():
    corpus, scored, names = _score(
        [
            XmlNode(
                "customer",
                children=[
                    XmlNode("billingaddress", children=[XmlNode("street", "Main")]),
                    XmlNode("shippingaddress", children=[XmlNode("street", "Other")]),
                ],
            )
        ]
    )
    address_pair = next(
        item
        for item in scored
        if {names[item.left], names[item.right]}
        == {"billingaddress", "shippingaddress"}
    )
    street_ids = {
        profile.profile_id
        for profile in corpus.profiles
        if profile.name.local_name == "street"
    }
    street_pair = next(item for item in scored if {item.left, item.right} == street_ids)

    assert address_pair.relation == "shared_structure"
    assert "co_occurring_sibling_roles" in address_pair.conflicts
    assert any("role_conflict" in conflict for conflict in address_pair.conflicts)
    assert street_pair.relation != "equivalent"
    assert "ancestor_role_conflict" in street_pair.conflicts


def test_one_to_one_children_penalizes_a_missing_distinct_field():
    _, scored, names = _score(
        [
            XmlNode(
                "customer", children=[XmlNode("street", "A"), XmlNode("road", "B")]
            ),
            XmlNode("client", children=[XmlNode("street", "A")]),
        ]
    )
    parent = next(
        item
        for item in scored
        if {names[item.left], names[item.right]} == {"customer", "client"}
    )

    assert dict(parent.features)["children"] <= 0.5
    assert dict(parent.features)["cardinality"] == 0.5
    assert parent.relation != "equivalent"


def test_same_spelling_across_namespaces_is_not_silently_equated():
    _, scored, _ = _score(
        [XmlNode("{urn:first}name", "A"), XmlNode("{urn:second}name", "A")]
    )

    assert len(scored) == 1
    assert scored[0].relation != "equivalent"
    assert "different_namespaces" in scored[0].conflicts


def test_ancestor_and_descendant_are_not_equivalent():
    _, scored, _ = _score([XmlNode("customer", children=[XmlNode("client")])])

    assert scored[0].relation != "equivalent"
    assert "ancestor_descendant_roles" in scored[0].conflicts


def test_incompatible_observed_value_types_are_explained():
    _, scored, _ = _score([XmlNode("customer", "false"), XmlNode("client", "72")])

    assert scored[0].relation != "equivalent"
    assert "incompatible_observed_value_types" in scored[0].conflicts


def test_alignment_truncation_is_explicit_and_keeps_full_unmatched_denominator():
    config = MatchingConfig(max_child_slots=1)
    _, scored, names = _score(
        [
            XmlNode("customer", children=[XmlNode("street"), XmlNode("postcode")]),
            XmlNode("client", children=[XmlNode("street"), XmlNode("postcode")]),
        ],
        config,
    )
    parent = next(
        item
        for item in scored
        if {names[item.left], names[item.right]} == {"customer", "client"}
    )

    assert dict(parent.features)["children"] <= 0.5
    assert "child_alignment_truncated" in parent.conflicts
    assert parent.relation != "equivalent"


def test_rejects_missing_results_and_reused_assignment_columns():
    corpus = observe_documents(
        [
            XmlNode("customer", children=[XmlNode("street"), XmlNode("postcode")]),
            XmlNode("client", children=[XmlNode("road"), XmlNode("zipcode")]),
        ]
    )
    candidates = prepare_candidates(corpus, _lexicon())
    requests = prepare_alignments(corpus, candidates)
    results = _solve(requests)

    with pytest.raises(ScoreCorrespondencesError, match="exactly one"):
        score_correspondences(corpus, candidates, requests, ())

    index = next(
        index
        for index, request in enumerate(requests)
        if len(request.left_slots) == len(request.right_slots) == 2
    )
    invalid = list(results)
    invalid[index] = replace(invalid[index], pairs=((0, 0), (1, 0)))

    with pytest.raises(ScoreCorrespondencesError, match="distinct"):
        score_correspondences(corpus, candidates, requests, invalid)


def test_scoring_and_explanations_are_permutation_stable():
    roots = [
        XmlNode("customer", children=[XmlNode("street", "A")]),
        XmlNode("client", children=[XmlNode("road", "B")]),
    ]

    assert _score(roots)[1] == _score(roots[::-1])[1]


def test_generic_leaf_names_do_not_equate_unrelated_business_contexts():
    corpus, scored, _ = _score(
        [
            XmlNode(
                "directory",
                children=[XmlNode("person", children=[XmlNode("postcode", "001")])],
            ),
            XmlNode(
                "customer",
                children=[
                    XmlNode("billingaddress", children=[XmlNode("postcode", "001")])
                ],
            ),
        ]
    )
    identifiers = {
        profile.profile_id
        for profile in corpus.profiles
        if profile.name.local_name == "postcode"
    }
    pair = next(item for item in scored if {item.left, item.right} == identifiers)

    assert pair.relation != "equivalent"
    assert "incompatible_ancestor_context" in pair.conflicts


def test_namespace_mapping_can_be_proposed_when_both_names_and_structure_support_it():
    corpus, scored, _ = _score(
        [
            XmlNode("{urn:v1}customer", children=[XmlNode("{urn:v1}street", "Main")]),
            XmlNode("{urn:v2}client", children=[XmlNode("{urn:v2}road", "Main")]),
        ]
    )
    roots = {
        profile.profile_id
        for profile in corpus.profiles
        if profile.parent_profile_id is None
    }
    leaves = {
        profile.profile_id
        for profile in corpus.profiles
        if profile.parent_profile_id is not None
    }
    root_match = next(item for item in scored if {item.left, item.right} == roots)
    leaf_match = next(item for item in scored if {item.left, item.right} == leaves)

    assert root_match.relation == "equivalent"
    assert leaf_match.relation == "equivalent"
    assert "namespace_mapping_supported_by_context" in root_match.evidence
    assert len(corpus.profiles) == 4


def test_two_informative_child_roles_can_anchor_unknown_root_names():
    corpus, scored, names = _score(
        [
            XmlNode(
                "purchaseorder",
                children=[
                    XmlNode("billingaddress", children=[XmlNode("street", "A")]),
                    XmlNode("shippingaddress", children=[XmlNode("street", "B")]),
                ],
            ),
            XmlNode(
                "salerequest",
                children=[
                    XmlNode("invoicelocation", children=[XmlNode("road", "A")]),
                    XmlNode("deliverylocation", children=[XmlNode("road", "B")]),
                ],
            ),
        ]
    )
    root_ids = {
        profile.profile_id
        for profile in corpus.profiles
        if profile.parent_profile_id is None
    }
    root_pair = next(item for item in scored if {item.left, item.right} == root_ids)
    billing = next(
        item
        for item in scored
        if {names[item.left], names[item.right]}
        == {"billingaddress", "invoicelocation"}
    )

    assert dict(root_pair.features)["context_anchors"] >= 2
    assert root_pair.relation == "shared_structure"
    assert billing.relation == "equivalent"


def test_one_generic_child_does_not_resolve_homonymous_parent_contexts():
    corpus, scored, _ = _score(
        [
            XmlNode(
                "paymentrecord",
                children=[
                    XmlNode(
                        "financialinstitution",
                        children=[XmlNode("bank", children=[XmlNode("name", "A")])],
                    ),
                    XmlNode(
                        "river",
                        children=[XmlNode("bank", children=[XmlNode("name", "B")])],
                    ),
                ],
            ),
        ]
    )
    name_ids = {
        profile.profile_id
        for profile in corpus.profiles
        if profile.name.local_name == "name"
    }
    pair = next(item for item in scored if {item.left, item.right} == name_ids)

    assert pair.relation != "equivalent"
    assert {"incompatible_ancestor_context", "ancestor_role_conflict"} & set(
        pair.conflicts
    )


def test_specific_parent_role_can_anchor_a_leaf_without_equating_unknown_roots():
    corpus, scored, names = _score(
        [
            XmlNode(
                "{urn:first}purchaseorder",
                children=[
                    XmlNode(
                        "{urn:first}billingaddress",
                        children=[XmlNode("{urn:first}street", "Main")],
                    ),
                ],
            ),
            XmlNode(
                "{urn:second}salerequest",
                children=[
                    XmlNode(
                        "{urn:second}invoicelocation",
                        children=[XmlNode("{urn:second}road", "Main")],
                    ),
                ],
            ),
        ]
    )
    root_ids = {
        profile.profile_id
        for profile in corpus.profiles
        if profile.parent_profile_id is None
    }
    root_pair = next(item for item in scored if {item.left, item.right} == root_ids)
    street = next(
        item
        for item in scored
        if {names[item.left], names[item.right]} == {"street", "road"}
    )

    assert root_pair.relation != "equivalent"
    assert street.relation == "equivalent"
    assert "namespace_mapping_supported_by_context" in street.evidence
