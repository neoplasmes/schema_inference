import json
from itertools import permutations

import pytest

from app.use_cases.infer_schema import InferSchema, InferSchemaError
from core.entities import XmlNode
from core.entities.inference import InferenceLimits
from core.entities.lexical import LexiconData


class MemoryLexicalResource:
    def __init__(self):
        self.calls = 0

    def load(self):
        self.calls += 1

        return LexiconData(unigrams={"price": 10})


def test_empty_input_does_not_load_dictionaries():
    resource = MemoryLexicalResource()
    inference = InferSchema(lexical_resource=resource)

    assert inference.analyze([])["nodes"] == []
    assert json.loads(inference.execute([])) == {}
    assert resource.calls == 0


def test_limits_are_reported_before_loading_dictionaries():
    resource = MemoryLexicalResource()
    inference = InferSchema(
        lexical_resource=resource, limits=InferenceLimits(max_documents=1)
    )

    with pytest.raises(InferSchemaError):
        inference.execute([XmlNode("aa"), XmlNode("bb")])

    assert resource.calls == 0


def test_inference_leaves_input_unchanged_and_loads_once():
    resource = MemoryLexicalResource()
    node = XmlNode("order", children=[XmlNode("price", "10")])
    inference = InferSchema(lexical_resource=resource)
    result = inference.analyze([node])

    assert resource.calls == 1
    assert node.children[0].tag == "price"
    assert result["version"] == 1
    assert "correspondences" not in result


def test_editor_receives_expanded_legacy_expressions_and_valid_references():
    roots = [
        XmlNode(
            "order",
            children=[
                XmlNode("buyer", children=[XmlNode("name", "a")]),
                XmlNode("seller", children=[XmlNode("name", "b")]),
            ],
        )
    ]
    result = json.loads(InferSchema().execute(roots))
    (root,) = [key for key in result if key.startswith("begin-c/")]
    pending = [result[root]["expression"]]
    names = []

    while pending:
        node = pending.pop()

        if node["type"] == "LEAF":
            assert node["value"] in result
            names.append(node["value"])

        pending.extend(node["children"])

    name_keys = [key for key in names if key.endswith("/name-s")]
    assert len(set(name_keys)) == 2
    assert all(result[key]["XSDTypes"] == {"string": 1} for key in name_keys)


def test_document_order_preserves_structures_and_frequencies():
    """Compare observed meaning across permutations without depending on local IDs."""
    roots = [
        XmlNode("order", children=[XmlNode("aa", "1")]),
        XmlNode("order", children=[XmlNode("bb", "2")]),
        XmlNode("order", children=[XmlNode("aa", "3")]),
    ]

    def observations(space):
        nodes = {node["id"]: node for node in space["nodes"]}

        def structure(reference):
            node = nodes[reference["node"]]
            variant = next(
                item
                for item in node["content"]["alternatives"]
                if item["id"] == reference["variant"]
            )

            return (
                tuple(node["path"]),
                variant["kind"],
                frozenset(structure(child) for child in variant["children"]),
            )

        variants = {
            structure(reference): (reference["count"], reference["probability"])
            for reference in space["roots"]
        }
        fields = {
            tuple(node["path"]): (
                node["occurrences"],
                node["parent_occurrences"],
                node["presence_count"],
                node["presence_probability"],
                {item["value"]: item["probability"] for item in node["data_types"]},
            )
            for node in space["nodes"]
        }

        return variants, fields

    def editor_structure(expression):
        return (
            expression["type"],
            expression["value"].rsplit("/", 1)[-1],
            expression["probability"],
            frozenset(editor_structure(child) for child in expression["children"]),
        )

    inference = InferSchema()
    expected = observations(inference.analyze(roots))
    expected_editor = None

    for order in permutations(roots):
        space = inference.analyze(order)
        assert observations(space) == expected
        exported = json.loads(inference.execute(order))
        (root,) = [key for key in exported if key.startswith("begin-c/")]
        expression = editor_structure(exported[root]["expression"])

        if expected_editor is None:
            expected_editor = expression

        assert expression == expected_editor


def test_selected_null_type_produces_a_nillable_xsd_element():
    from core.entities import SchemaNode
    from core.processes.build_xsd import build_xsd

    root = SchemaNode("empty", "name", "LEAF", 1, 1, [], {})
    element = build_xsd(root).children[0]

    assert element.attributes["type"] == "xs:string"
    assert element.attributes["nillable"] == "true"
