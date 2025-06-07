from dataclasses import FrozenInstanceError

import pytest

from core.entities import XmlNode
from core.entities.observations import ExpandedName, ObservationLimits
from core.processes.observe_documents import ObserveDocumentsError, observe_documents


def test_preserves_expanded_names_and_full_ancestor_context():
    first = XmlNode(
        "{https://Example.org/order-v1/path}Order",
        children=[XmlNode("{https://Example.org/order-v1/path}Item-ID")],
    )
    second = XmlNode(
        "{https://example.org/order-v1/path}Order",
        children=[XmlNode("{https://Example.org/order-v1/path}Item-ID")],
    )
    corpus = observe_documents([first, second, XmlNode("order")])
    profiles = {profile.path: profile for profile in corpus.profiles}
    first_path = (
        ExpandedName("https://Example.org/order-v1/path", "Order"),
        ExpandedName("https://Example.org/order-v1/path", "Item-ID"),
    )
    second_path = (
        ExpandedName("https://example.org/order-v1/path", "Order"),
        ExpandedName("https://Example.org/order-v1/path", "Item-ID"),
    )

    assert len(profiles) == 5
    assert profiles[first_path].profile_id != profiles[second_path].profile_id
    assert profiles[first_path].name.clark_name == first.children[0].tag
    assert sum(profile.parent_profile_id is None for profile in corpus.profiles) == 3


def test_does_not_confuse_path_separator_characters_with_ancestors():
    root = XmlNode(
        "root",
        children=[
            XmlNode("{urn:example/a/b-c}value"),
            XmlNode("{urn:example/a}b-c", children=[XmlNode("value")]),
        ],
    )
    corpus = observe_documents([root])

    assert len(corpus.profiles) == 4
    assert len({profile.profile_id for profile in corpus.profiles}) == 4


def test_preserves_child_sequence_order_multiplicity_and_empty_alternative():
    roots = [
        XmlNode("root", children=[XmlNode(name) for name in names])
        for names in [("a", "b", "a"), ("b", "a", "a"), ()]
    ]
    corpus = observe_documents(roots)
    profiles = {profile.name.local_name: profile for profile in corpus.profiles}
    names = {profile.profile_id: profile.name.local_name for profile in corpus.profiles}
    variants = {
        tuple(names[child] for child in variant.child_profile_ids): variant
        for variant in profiles["root"].child_sequences
    }

    assert set(variants) == {("a", "b", "a"), ("b", "a", "a"), ()}
    assert all(variant.count == 1 for variant in variants.values())
    assert all(
        variant.frequency == pytest.approx(1 / 3) for variant in variants.values()
    )
    assert profiles["a"].occurrence_count == 4
    assert profiles["a"].document_count == 2
    assert profiles["b"].occurrence_count == 2


def test_counts_each_repeated_parent_in_child_sequence_frequency():
    corpus = observe_documents(
        [
            XmlNode(
                "root",
                children=[
                    XmlNode("item", children=[XmlNode("value", "1")]),
                    XmlNode("item", children=[XmlNode("value", "2")]),
                    XmlNode("item"),
                ],
            )
        ]
    )
    profile = next(
        profile for profile in corpus.profiles if profile.name.local_name == "item"
    )
    variants = {len(item.child_profile_ids): item for item in profile.child_sequences}

    assert profile.occurrence_count == 3
    assert profile.document_count == 1
    assert variants[0].count == 1
    assert variants[0].frequency == pytest.approx(1 / 3)
    assert variants[1].count == 2
    assert variants[1].frequency == pytest.approx(2 / 3)


def test_distinguishes_absent_empty_and_nil_nodes():
    nil_name = "{http://www.w3.org/2001/XMLSchema-instance}nil"
    roots = [
        XmlNode("root"),
        XmlNode("root", children=[XmlNode("value")]),
        XmlNode("root", children=[XmlNode("value", attributes={nil_name: "true"})]),
        XmlNode("root", children=[XmlNode("value", attributes={nil_name: "false"})]),
    ]
    corpus = observe_documents(roots)
    values = next(
        profile for profile in corpus.profiles if profile.name.local_name == "value"
    )
    parents = next(
        profile for profile in corpus.profiles if profile.name.local_name == "root"
    )

    assert values.occurrence_count == 3
    assert {item.nil for item in values.observations} == {None, True, False}
    assert {item.kind for item in values.observations} == {"empty"}
    assert any(
        not variant.child_profile_ids and variant.count == 1
        for variant in parents.child_sequences
    )


@pytest.mark.parametrize(
    "lexical,expected",
    [("1", True), (" true ", True), ("0", False), ("false", False), ("yes", None)],
)
def test_preserves_nil_lexical_value_even_when_not_a_valid_boolean(lexical, expected):
    root = XmlNode(
        "root", attributes={"{http://www.w3.org/2001/XMLSchema-instance}nil": lexical}
    )
    observation = observe_documents([root]).observations[0]

    assert observation.nil is expected
    assert observation.attributes[0].value == lexical


def test_keeps_text_tail_attributes_and_source_positions():
    root = XmlNode(
        "paragraph",
        "Hello ",
        {"{urn:Test/Namespace}ID": "001", "id": "different"},
        [XmlNode("em", "world", tail="!")],
    )
    corpus = observe_documents([root])
    observations = {item.position: item for item in corpus.observations}

    assert observations[()].kind == "mixed"
    assert observations[()].text == "Hello "
    assert observations[(0,)].kind == "text"
    assert observations[(0,)].tail == "!"
    assert {attribute.name for attribute in observations[()].attributes} == {
        ExpandedName("urn:Test/Namespace", "ID"),
        ExpandedName("", "id"),
    }
    assert observations[()].document_id == observations[(0,)].document_id
    assert observations[()].child_profile_ids == (observations[(0,)].profile_id,)


def test_a_child_tail_belongs_to_parent_mixed_content():
    root = XmlNode("paragraph", children=[XmlNode("br", tail="following text")])
    observations = {
        item.position: item for item in observe_documents([root]).observations
    }

    assert observations[()].kind == "mixed"
    assert observations[(0,)].kind == "empty"


def test_corpus_is_invariant_under_input_permutation():
    first = XmlNode("root", children=[XmlNode("a", "1"), XmlNode("b")])
    second = XmlNode("another", attributes={"z": "1", "a": "2"})

    assert observe_documents([first, second, first]) == observe_documents(
        [second, first, first]
    )


def test_duplicate_corpus_doubles_counts_without_changing_frequencies():
    roots = [XmlNode("root"), XmlNode("root", children=[XmlNode("a")])]
    original = observe_documents(roots)
    duplicated = observe_documents(roots * 2)
    by_id = {profile.profile_id: profile for profile in duplicated.profiles}

    assert duplicated.document_count == original.document_count * 2
    assert duplicated.node_count == original.node_count * 2
    assert len({document.document_id for document in duplicated.documents}) == 4

    for profile in original.profiles:
        duplicate = by_id[profile.profile_id]

        assert duplicate.occurrence_count == profile.occurrence_count * 2
        assert duplicate.document_count == profile.document_count * 2

        for before, after in zip(
            profile.child_sequences, duplicate.child_sequences, strict=True
        ):
            assert before.child_profile_ids == after.child_profile_ids
            assert before.frequency == after.frequency
            assert before.count * 2 == after.count


def test_attribute_input_order_does_not_change_document_identity():
    first = XmlNode("root", attributes={"a": "1", "b": "2"})
    second = XmlNode("root", attributes={"b": "2", "a": "1"})

    assert observe_documents([first]) == observe_documents([second])


def test_corpus_is_an_immutable_snapshot_of_mutable_input():
    root = XmlNode(
        "root",
        text="original",
        attributes={"key": "value"},
        children=[XmlNode("child")],
    )
    corpus = observe_documents([root])
    before = repr(corpus)
    root.text = "changed"
    root.attributes["key"] = "changed"
    root.children.clear()

    assert repr(corpus) == before

    for attribute_name in ("documents", "profiles"):
        with pytest.raises(FrozenInstanceError):
            setattr(corpus, attribute_name, ())


def test_identical_local_names_under_different_ancestors_have_distinct_profiles():
    root = XmlNode(
        "root",
        children=[
            XmlNode("billing", children=[XmlNode("address")]),
            XmlNode("shipping", children=[XmlNode("address")]),
        ],
    )
    corpus = observe_documents([root])
    addresses = [
        profile for profile in corpus.profiles if profile.name.local_name == "address"
    ]

    assert len(addresses) == 2
    assert addresses[0].parent_profile_id != addresses[1].parent_profile_id


def test_empty_corpus_has_no_invented_roots():
    corpus = observe_documents([])

    assert corpus.documents == ()
    assert corpus.profiles == ()
    assert corpus.node_count == 0


@pytest.mark.parametrize(
    "roots,limits,message",
    [
        (
            [XmlNode("a"), XmlNode("b")],
            ObservationLimits(max_documents=1),
            "max_documents",
        ),
        (
            [XmlNode("a", children=[XmlNode("b")])],
            ObservationLimits(max_nodes=1),
            "max_nodes",
        ),
        (
            [XmlNode("a", children=[XmlNode("b")])],
            ObservationLimits(max_depth=1),
            "max_depth",
        ),
        ([], ObservationLimits(max_depth=0), "positive integers"),
    ],
)
def test_resource_limits_fail_explicitly(roots, limits, message):
    with pytest.raises(ObserveDocumentsError, match=message):
        observe_documents(roots, limits)


def test_rejects_cyclic_input_without_recursing():
    root = XmlNode("root")
    root.children.append(root)

    with pytest.raises(ObserveDocumentsError, match="cyclic"):
        observe_documents([root])


def test_deep_documents_use_iterative_traversal():
    root = XmlNode("root")
    current = root

    for _ in range(600):
        current = current.add_child("child")

    corpus = observe_documents([root], ObservationLimits(max_depth=700))

    assert corpus.node_count == 601
    assert max(len(profile.path) for profile in corpus.profiles) == 601
