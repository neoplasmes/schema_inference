import copy

import pytest

from core.entities import DocumentNode, XmlDocumentNode, YamlDocumentNode


def build(root: DocumentNode, syntax: str):
    from core.processes.build_schema_draft import build_schema_draft

    return build_schema_draft(root, syntax)


def test_xml_keeps_namespaces_attributes_and_repeated_child_order():
    root = XmlDocumentNode(
        "{urn:orders}order",
        attributes={"{urn:meta}code": "14"},
        children=[
            XmlDocumentNode("item", "first"),
            XmlDocumentNode("note", "middle"),
            XmlDocumentNode("item", "last"),
        ],
    )
    graph = build(root, "xml")
    element = graph.nodes[graph.root_node_id]
    content = graph.nodes[element["contentNodeId"]]
    group = graph.nodes[content["particleNodeId"]]
    particles = graph.collections[group["particles"]["id"]]
    attributes = graph.collections[content["attributes"]["id"]]

    assert graph.profile == {"syntax": "xml", "dialect": "xsd-1.0"}
    assert element["name"] == {"namespaceUri": "urn:orders", "localName": "order"}
    assert [
        graph.nodes[row["valueNodeId"]]["name"]["localName"] for row in particles
    ] == [
        "item",
        "note",
        "item",
    ]
    assert len({row["id"] for row in particles}) == 3
    assert all(row["minOccurs"] == 1 for row in particles)
    assert all(row["maxOccurs"] == 1 for row in particles)
    assert attributes[0]["name"] == {
        "namespaceUri": "urn:meta",
        "localName": "code",
    }
    assert attributes[0]["required"] is True
    assert graph.nodes[attributes[0]["valueNodeId"]]["scalarType"] == "integer"


def test_xml_scalar_text_with_attributes_retains_both():
    graph = build(XmlDocumentNode("price", "12.50", {"currency": "USD"}), "xml")
    element = graph.nodes[graph.root_node_id]
    content = graph.nodes[element["contentNodeId"]]

    assert content["kind"] == "xmlComplex"
    assert content["particleNodeId"] is None
    assert content["mixed"] is False
    assert graph.nodes[content["simpleContentNodeId"]]["scalarType"] == "decimal"
    assert (
        graph.collections[content["attributes"]["id"]][0]["name"]["localName"]
        == "currency"
    )


def test_mixed_xml_preserves_element_children_and_marks_text_content():
    root = XmlDocumentNode(
        "paragraph", "Hello ", children=[XmlDocumentNode("strong", "world", tail="!")]
    )
    graph = build(root, "xml")
    content = graph.nodes[graph.nodes[graph.root_node_id]["contentNodeId"]]
    group = graph.nodes[content["particleNodeId"]]

    assert content["mixed"] is True
    assert content["simpleContentNodeId"] is None
    particle = graph.collections[group["particles"]["id"]][0]

    assert graph.nodes[particle["valueNodeId"]]["name"]["localName"] == "strong"


def test_xsi_nil_is_not_a_business_attribute():
    root = XmlDocumentNode(
        "value", attributes={"{http://www.w3.org/2001/XMLSchema-instance}nil": "true"}
    )
    graph = build(root, "xml")
    element = graph.nodes[graph.root_node_id]

    assert element["nillable"] is True
    assert graph.nodes[element["contentNodeId"]]["scalarType"] == "null"
    assert graph.collections == {}


@pytest.mark.parametrize(
    "root",
    [
        XmlDocumentNode("value", "present"),
        XmlDocumentNode("value", children=[XmlDocumentNode("child")]),
    ],
)
def test_nil_elements_cannot_discard_observed_content(root):
    root.attributes["{http://www.w3.org/2001/XMLSchema-instance}nil"] = "true"

    with pytest.raises(ValueError, match="nil"):
        build(root, "xml")


@pytest.mark.parametrize("syntax", ["json", "yaml"])
def test_empty_containers_remain_distinct(syntax):
    root = YamlDocumentNode(
        "$document",
        node_kind="mapping",
        children=[
            YamlDocumentNode("items", node_kind="sequence"),
            YamlDocumentNode("metadata", node_kind="mapping"),
        ],
    )
    graph = build(root, syntax)
    node = graph.nodes[graph.root_node_id]
    rows = graph.collections[node["properties"]["id"]]
    array = graph.nodes[rows[0]["valueNodeId"]]
    mapping = graph.nodes[rows[1]["valueNodeId"]]

    assert graph.profile == {"syntax": syntax, "dialect": "json-schema-2020-12"}
    assert [row["name"] for row in rows] == ["items", "metadata"]
    assert array["kind"] == "array"
    assert (array["minItems"], array["maxItems"]) == (0, 0)
    assert graph.nodes[array["itemsNodeId"]]["scalarType"] == "null"
    assert mapping["kind"] == "object"
    assert mapping["properties"]["totalItems"] == 0
    assert graph.collections[mapping["properties"]["id"]] == []


def test_heterogeneous_array_keeps_coherent_object_alternatives():
    root = YamlDocumentNode(
        "$document",
        node_kind="sequence",
        children=[
            YamlDocumentNode(
                "[]",
                node_kind="mapping",
                children=[YamlDocumentNode("name", value_type="string", value="first")],
            ),
            YamlDocumentNode(
                "[]",
                node_kind="mapping",
                children=[YamlDocumentNode("amount", value_type="integer", value=3)],
            ),
            YamlDocumentNode(
                "[]",
                node_kind="mapping",
                children=[
                    YamlDocumentNode("name", value_type="string", value="second")
                ],
            ),
        ],
    )
    graph = build(root, "json")
    array = graph.nodes[graph.root_node_id]
    union = graph.nodes[array["itemsNodeId"]]
    options = graph.collections[union["options"]["id"]]

    assert (array["minItems"], array["maxItems"]) == (0, None)
    assert union["kind"] == "union"
    assert union["mode"] == "anyOf"
    assert len(options) == 2
    names = []

    for option in options:
        mapping = graph.nodes[option["valueNodeId"]]
        fields = graph.collections[mapping["properties"]["id"]]
        names.append([field["name"] for field in fields])

    assert names == [["name"], ["amount"]]


def test_graph_is_deterministic_detached_and_has_valid_member_references():
    root = XmlDocumentNode("root", children=[XmlDocumentNode("value", "1e3")])
    original = copy.deepcopy(root)
    first = build(root, "xml")
    second = build(copy.deepcopy(root), "xml")

    assert first == second
    assert root == original

    for rows in first.collections.values():
        for row in rows:
            node = first.nodes[row["valueNodeId"]]
            assert row["valueNodeId"] == node["id"]
            assert row["id"]
            assert row["kind"] in {"xmlParticle", "xmlAttribute"}

    assert any(node.get("scalarType") == "number" for node in first.nodes.values())
    first.nodes[first.root_node_id]["name"]["localName"] = "changed"

    assert root.tag == "root"
    assert second.nodes[second.root_node_id]["name"]["localName"] == "root"


def test_cyclic_document_is_rejected_before_building_a_graph():
    root = YamlDocumentNode("$document", node_kind="mapping")
    root.children.append(root)

    with pytest.raises(ValueError, match="cycle"):
        build(root, "json")


def test_unsupported_syntax_is_rejected():
    with pytest.raises(ValueError, match="syntax"):
        build(DocumentNode("root"), "toml")
