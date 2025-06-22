import json

import pytest

from core.entities import XmlNode
from core.processes.build_probability_space import build_probability_space
from core.processes.observe_documents import observe_documents


def space_for(*roots):
    return build_probability_space(observe_documents(roots))


def profile_for(space, name):
    return next(item for item in space["profiles"] if item["name"]["local"] == name)


def test_content_alternatives_preserve_correlations_and_repetitions():
    first = XmlNode("record", children=[XmlNode("a"), XmlNode("b"), XmlNode("a")])
    second = XmlNode("record", children=[XmlNode("c"), XmlNode("d")])
    space = space_for(first, second, first)
    root = profile_for(space, "record")
    names = {item["id"]: item["name"]["local"] for item in space["profiles"]}
    alternatives = {
        tuple(names[child] for child in item["children"]): item
        for item in root["content"]["alternatives"]
    }

    assert set(alternatives) == {("a", "b", "a"), ("c", "d")}
    assert alternatives[("a", "b", "a")]["count"] == 2
    assert alternatives[("a", "b", "a")]["frequency"] == pytest.approx(2 / 3)
    assert len(alternatives[("a", "b", "a")]["sources"]) == 2
    cardinalities = {
        names[item["profile"]]: item for item in root["child_cardinalities"]
    }
    assert cardinalities["a"]["minimum_observed"] == 0
    assert cardinalities["a"]["maximum_observed"] == 2
    assert sum(item["frequency"] for item in alternatives.values()) == 1


def test_attribute_denominator_is_parent_occurrences_not_document_count():
    root = XmlNode(
        "list",
        children=[
            XmlNode("item", attributes={"id": "001"}),
            XmlNode("item", attributes={"id": "002"}),
            XmlNode("item"),
        ],
    )
    profile = profile_for(space_for(root), "item")
    attribute = profile["attributes"][0]

    assert attribute["present"] == 2
    assert attribute["absent"] == 1
    assert attribute["presence_frequency"] == pytest.approx(2 / 3)
    assert attribute["value_types"]["candidates"] == [
        {"type": "string", "supported_values": 2, "support_fraction": 1}
    ]


def test_empty_nil_and_value_are_distinct_observations():
    nil_name = "{http://www.w3.org/2001/XMLSchema-instance}nil"
    space = space_for(
        XmlNode("value"),
        XmlNode("value", "42"),
        XmlNode("value", "99", attributes={nil_name: "true"}),
    )
    profile = profile_for(space, "value")

    assert profile["value_types"]["total"] == 1
    assert {item["value"]: item["count"] for item in profile["nil"]} == {
        "true": 1,
        "unspecified": 2,
    }
    assert {item["text"] for item in profile["observations"]} == {None, "42", "99"}


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("00123", {"string"}),
        ("-42", {"string", "integer"}),
        ("1", {"string", "integer", "boolean"}),
        ("false", {"string", "boolean"}),
        ("12.50", {"string", "decimal"}),
        ("1e6", {"string", "double"}),
        ("1e9999", {"string"}),
        ("NaN", {"string"}),
        ("2024-02-29", {"string", "date"}),
        ("2025-02-29", {"string"}),
        ("2025-06-30T23:59:59Z", {"string", "dateTime"}),
        ("2025-06-30T25:59:59Z", {"string"}),
        ("2025-06-30T23:59:59+14:00", {"string", "dateTime"}),
        ("2025-06-30T23:59:59-14:00", {"string", "dateTime"}),
        ("2025-06-30T23:59:59+14:01", {"string"}),
        ("2025-06-30T23:59:59+15:00", {"string"}),
        ("2025-06-30T23:59:59-15:00", {"string"}),
        ("2025-06-30T23:59:59+00:99", {"string"}),
    ],
)
def test_value_types_keep_lexical_constraints(value, expected):
    profile = profile_for(space_for(XmlNode("value", value)), "value")

    assert {item["type"] for item in profile["value_types"]["candidates"]} == expected


def test_mixed_content_and_expanded_names_survive_json_round_trip():
    root = XmlNode(
        "{urn:one}line",
        "before ",
        attributes={"{urn:two}id": "a"},
        children=[XmlNode("{urn:two}mark", "inside", tail=" after")],
    )
    space = json.loads(json.dumps(space_for(root), allow_nan=False))
    profile = profile_for(space, "line")
    child = profile_for(space, "mark")

    assert profile["name"]["namespace"] == "urn:one"
    assert child["path"][0]["namespace"] == "urn:one"
    assert profile["attributes"][0]["name"]["namespace"] == "urn:two"
    assert profile["observations"][0]["kind"] == "mixed"
    assert child["observations"][0]["tail"] == " after"


def test_empty_corpus_has_no_fabricated_frequencies_or_types():
    space = space_for()

    assert space["profiles"] == []
    assert space["roots"] == []
    assert space["statistics"]["documents"] == 0
    assert space["decision_policy"]["scores_are_probabilities"] is False


def test_keep_separate_is_explicit_without_fake_complement_probability():
    corpus = observe_documents([XmlNode("first"), XmlNode("second")])
    space = build_probability_space(
        corpus,
        correspondences=[{"relation": "related", "score": 0.7}],
    )
    correspondence = space["correspondences"][0]

    assert correspondence["score_kind"] == "heuristic"
    assert correspondence["alternatives"] == [
        {"relation": "related", "score": 0.7},
        {"relation": "keep_separate", "score": None},
    ]
