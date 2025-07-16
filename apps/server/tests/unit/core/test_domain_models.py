from dataclasses import FrozenInstanceError, replace
from typing import Any

import pytest

from core.entities import SelectedSchemaNode, SelectedSchemaNodeError, XmlDocumentNode
from core.entities.probability_space import (
    Frequency,
    ProbabilitySpace,
    VariantReference,
)
from core.processes.build_probability_space import build_probability_space
from core.processes.build_xsd import build_xsd
from core.processes.normalize_documents import normalize_documents


@pytest.mark.parametrize(
    "changes",
    [
        {"name": ""},
        {"name": "bad name"},
        {"name": "名称"},
        {"name": "élément"},
        {"name": "1field"},
        {"name": "prefix:field"},
        {"name": "a\x00b"},
        {"chosen_type": "unknown"},
        {"chosen_type": "xs:string"},
        {"min_occurs": -1},
        {"min_occurs": True},
        {"max_occurs": False},
        {"max_occurs": 1.5},
        {"min_occurs": 2, "max_occurs": 1},
        {"max_occurs": "2"},
        {"children": (SelectedSchemaNode("child", "string"),)},
        {"attributes": {"bad name": "string"}},
        {"attributes": {"xmlns": "string"}},
        {"attributes": {"id": "parent"}},
    ],
)
def test_selected_schema_rejects_invalid_states(changes: dict[str, Any]):
    """Reject invalid domain data even when no HTTP validation is involved."""
    with pytest.raises(SelectedSchemaNodeError):
        SelectedSchemaNode(**{"name": "field", "chosen_type": "string", **changes})


def test_selection_copies_collections_and_cannot_be_mutated():
    """Prevent external mutations from invalidating an already validated selection."""
    attributes = {"id": "integer"}
    children: Any = [SelectedSchemaNode("child", "string")]
    root = SelectedSchemaNode(
        "root", "parent", children=children, attributes=attributes
    )
    attributes["id"] = "parent"
    children.clear()

    assert root.attributes["id"] == "integer"
    assert len(root.children) == 1

    immutable_root: Any = root

    with pytest.raises(FrozenInstanceError):
        immutable_root.chosen_type = "string"

    immutable_attributes: Any = root.attributes

    with pytest.raises(TypeError):
        immutable_attributes["id"] = "parent"


def test_supported_names_and_unbounded_occurrences_reach_xsd():
    """Keep Latin and Russian names and explicitly unbounded repetitions."""
    child = SelectedSchemaNode("_Element.Ёж-ё2", "null", 0, "unbounded")
    root = SelectedSchemaNode("корень", "parent", children=(child,))
    element = build_xsd(root).children[0].children[0].children[0].children[0]

    assert element.attributes == {
        "name": "_Element.Ёж-ё2",
        "nillable": "true",
        "minOccurs": "0",
        "maxOccurs": "unbounded",
        "type": "xs:string",
    }


@pytest.mark.parametrize("count,total", [(0, 1), (-1, 1), (2, 1), (1, 0), (True, 1)])
def test_frequency_rejects_impossible_counts(count, total):
    with pytest.raises(ValueError):
        Frequency("integer", count, total)


def test_probability_is_derived_from_counts():
    frequency = Frequency("integer", 2, 3)

    assert frequency.probability == 2 / 3
    assert replace(frequency, count=1).probability == 1 / 3


def sample_space() -> ProbabilitySpace:
    return build_probability_space(
        normalize_documents(
            [
                XmlDocumentNode("root", children=[XmlDocumentNode("price", "1")]),
                XmlDocumentNode("root", children=[XmlDocumentNode("price", "2")]),
            ]
        )
    )


def test_analysis_exposes_typed_fields_and_observations():
    space = sample_space()
    root, price = space.nodes

    assert isinstance(space, ProbabilitySpace)
    assert root.variants[0].value.children == (
        VariantReference(price.id, price.variants[0].value.id),
    )
    assert price.data_types == (Frequency("integer", 2, 2),)
    assert price.presence_probability == 1
    assert tuple(source.document for source in price.sources) == (0, 1)


@pytest.mark.parametrize(
    "change",
    [
        {"presence_count": 3},
        {"data_types": (Frequency("integer", 1, 2),)},
        {"data_types": (Frequency("integer", 2, 3),)},
        {"sources": ()},
    ],
)
def test_field_rejects_inconsistent_statistics(change):
    with pytest.raises(ValueError):
        replace(sample_space().nodes[1], **change)


def test_field_rejects_sources_with_unobserved_variants():
    price = sample_space().nodes[1]

    with pytest.raises(ValueError, match="source observations"):
        replace(
            price,
            sources=(replace(price.sources[0], variant="missing"), price.sources[1]),
        )


def test_space_rejects_dangling_root_and_child_references():
    space = sample_space()
    root, price = space.nodes

    with pytest.raises(ValueError):
        replace(space, roots=(Frequency(VariantReference("missing", "missing"), 2, 2),))

    variant = replace(
        root.variants[0].value, children=(VariantReference(price.id, "missing"),)
    )
    root = replace(root, variants=(Frequency(variant, 2, 2),))

    with pytest.raises(ValueError, match="unknown child"):
        replace(space, nodes=(root, price))


def test_space_rejects_duplicate_fields_and_wrong_document_denominator():
    space = sample_space()

    with pytest.raises(ValueError):
        replace(space, nodes=(*space.nodes, space.nodes[1]))

    with pytest.raises(ValueError):
        replace(space, documents=3)
