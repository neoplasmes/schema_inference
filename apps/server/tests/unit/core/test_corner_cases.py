from io import BytesIO

import pytest

from app.use_cases.infer_schema import InferSchema
from core.entities import XmlDocumentNode
from core.entities.inference import InferenceLimits
from core.entities.lexical import LexiconData
from core.processes.build_probability_space import build_probability_space
from core.processes.normalize_documents import (
    NormalizeDocumentsError,
    normalize_documents,
)
from env.tools.document_reader.strategies import ElementTreeXmlDocumentTool
from env.tools.lexical import CorpusLexicalResourceTool
from env.tools.probability_space import serialize_probability_space
from env.tools.schema_expression import EditorSchemaExpressionWriter


def infer(*documents):
    reader = ElementTreeXmlDocumentTool()
    roots = [reader.read(BytesIO(text.encode())) for text in documents]
    resource = CorpusLexicalResourceTool(
        include_wordnet=False, include_word_frequencies=False
    )

    return serialize_probability_space(
        InferSchema(
            expression_writer=EditorSchemaExpressionWriter(), lexical_resource=resource
        ).analyze(roots)
    )


def field(space, *path):
    return next(node for node in space["nodes"] if node["path"] == list(path))


def distribution(node, key):
    return {item["value"]: item["probability"] for item in node[key]}


def test_typo_is_counted_separately_from_alternative_names():
    """Recognize the actual price/pirce example and count its original spelling."""
    space = infer(
        "<order><price>100</price></order>", "<order><pirce>100</pirce></order>"
    )
    price = field(space, "order", "price")

    assert price["typos"] == [
        {"value": "pirce", "count": 1, "probability": 0.5, "relation": "typo"}
    ]
    assert not price["alternative_names"]
    assert len(field(space, "order")["content"]["alternatives"]) == 1


def test_structures_are_observed_whole_alternatives():
    """Keep full name and first/last name as two observed shapes with equal weight."""
    space = infer(
        "<order><price>100</price><name>alex parker</name></order>",
        "<order><pirce>100</pirce><first_name>alex</first_name><last_name>parker</last_name></order>",
    )
    alternatives = field(space, "order")["content"]["alternatives"]
    names = {node["id"]: node["name"] for node in space["nodes"]}

    assert {
        frozenset(names[child["node"]] for child in item["children"])
        for item in alternatives
    } == {frozenset(["price", "name"]), frozenset(["price", "first_name", "last_name"])}
    assert [item["probability"] for item in alternatives] == [0.5, 0.5]


def test_semantic_name_is_a_dictionary_alias():
    """Count price and marketvalue as names of one field without a model."""
    space = infer(
        "<order><price>100</price></order>",
        "<order><marketvalue>100</marketvalue></order>",
    )
    price = field(space, "order", "price")

    assert distribution(price, "name_alternatives") == {
        "price": 0.5,
        "marketvalue": 0.5,
    }
    assert price["alternative_names"][0]["value"] == "marketvalue"
    assert not price["typos"]


def test_missing_field_changes_presence_but_not_value_types():
    """Count a missing discount only in the denominator for presence."""
    space = infer(
        "<order><price>100</price><discount>10</discount></order>",
        "<order><price>100</price></order>",
    )
    discount = field(space, "order", "discount")

    assert discount["presence_probability"] == 0.5
    assert discount["parent_occurrences"] == 2
    assert distribution(discount, "data_types") == {"integer": 1}


def test_attribute_and_element_are_one_field():
    """Treat an order ID attribute and child as alternate representations."""
    space = infer(
        '<order id="123"><price>100</price></order>',
        "<order><id>123</id><price>100</price></order>",
    )
    identifier = field(space, "order", "id")

    assert identifier["presence_probability"] == 1
    assert distribution(identifier, "representations") == {
        "element": 0.5,
        "attribute": 0.5,
    }
    assert len(field(space, "order")["content"]["alternatives"]) == 1


def test_equal_names_and_values_do_not_erase_parent_roles():
    """Keep buyer/name and seller/name distinct even when their values match."""
    space = infer(
        "<order><buyer><name>alex parker</name></buyer><seller><name>alex parker</name></seller></order>"
    )

    assert (
        field(space, "order", "buyer", "name")["id"]
        != field(space, "order", "seller", "name")["id"]
    )


def test_repetitions_and_order_do_not_create_structural_variants():
    """Deduplicate structural children while counting presence once per parent."""
    space = infer(
        "<order><item>book</item><price>100</price></order>",
        "<order><price>100</price><item>book</item><item>pen</item><item>paper</item></order>",
    )
    (variant,) = field(space, "order")["content"]["alternatives"]

    assert variant["count"] == 2
    assert variant["probability"] == 1
    assert len(variant["children"]) == 2
    assert field(space, "order", "item")["presence_count"] == 2
    assert field(space, "order", "item")["presence_probability"] == 1


def test_wrapping_a_field_remains_a_structural_alternative():
    """Keep direct and nested names without guessing a nesting transformation."""
    space = infer(
        "<order><name>alex parker</name></order>",
        "<order><customer><name>alex parker</name></customer></order>",
    )

    assert len(field(space, "order")["content"]["alternatives"]) == 2
    assert (
        field(space, "order", "name")["id"]
        != field(space, "order", "customer", "name")["id"]
    )


def test_text_and_structure_are_alternatives_of_the_same_field():
    """Keep a scalar price and a structured price in one field's content choice."""
    space = infer(
        "<price>100</price>",
        "<price><amount>100</amount><currency>USD</currency></price>",
    )

    assert {
        item["kind"] for item in field(space, "price")["content"]["alternatives"]
    } == {"value", "fields"}


def test_mixed_content_is_flattened_without_losing_text():
    """Discard decorative markup but include its text and tail in the value."""
    reader = ElementTreeXmlDocumentTool()
    roots = [
        reader.read(BytesIO(text.encode()))
        for text in (
            "<description>Очень <b>важный</b> заказ</description>",
            "<description>Очень важный заказ</description>",
        )
    ]
    normalized = normalize_documents(roots)

    assert [node.value for node in normalized] == ["Очень важный заказ"] * 2
    assert all(not node.children for node in normalized)
    space = serialize_probability_space(build_probability_space(normalized))
    assert len(space["nodes"]) == 1
    assert len(field(space, "description")["content"]["alternatives"]) == 1


def test_missing_and_present_empty_values_have_different_denominators():
    """Count four present null names out of five orders, never five null values."""
    space = infer(
        "<order/>",
        "<order><name/></order>",
        "<order><name></name></order>",
        "<order><name>   </name></order>",
        '<order xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><name xsi:nil="true"/></order>',
    )
    name = field(space, "order", "name")

    assert name["presence_probability"] == 0.8
    assert name["occurrences"] == 4
    assert distribution(name, "data_types") == {"null": 1}
    assert not any("nil" in node["name"] for node in space["nodes"])


def test_complete_nested_variants_preserve_correlations():
    """Do not admit unseen combinations after recursively aggregating child fields."""
    space = infer(
        "<record><left><aa/></left><right><bb/></right></record>",
        "<record><left><cc/></left><right><dd/></right></record>",
    )
    variants = field(space, "record")["content"]["alternatives"]

    assert len(variants) == 2
    assert all(len(item["children"]) == 2 for item in variants)
    assert (
        len(
            {tuple(child["variant"] for child in item["children"]) for item in variants}
        )
        == 2
    )


def test_repeated_parent_occurrences_define_presence():
    """Use three orders rather than one document as the presence denominator."""
    space = infer(
        "<orders><order><discount>1</discount></order><order/><order><discount>2</discount></order></orders>"
    )

    assert field(space, "orders", "order", "discount")[
        "presence_probability"
    ] == pytest.approx(2 / 3)


def test_counts_add_accumulated_variants_without_losing_occurrences():
    """Preserve 70/30 counts across repeated documents and their types."""
    space = infer(
        *(
            ["<record><aa>1</aa></record>"] * 70
            + ["<record><bb>text</bb></record>"] * 30
        )
    )

    assert sorted(
        item["count"] for item in field(space, "record")["content"]["alternatives"]
    ) == [30, 70]
    assert (
        sum(
            item["probability"]
            for item in field(space, "record")["content"]["alternatives"]
        )
        == 1
    )


def test_full_paths_and_namespaces_remain_distinct():
    """Protect identical immediate paths under different ancestors and namespaces."""
    space = infer(
        '<root xmlns:a="urn:a" xmlns:b="urn:b"><buyer><address><name>x</name></address></buyer><seller><address><name>x</name></address></seller><a:id>1</a:id><b:id>1</b:id></root>'
    )

    assert (
        field(space, "root", "buyer", "address", "name")["id"]
        != field(space, "root", "seller", "address", "name")["id"]
    )
    assert (
        field(space, "root", "{urn:a}id")["id"]
        != field(space, "root", "{urn:b}id")["id"]
    )


def test_unknown_names_are_not_forced_into_a_match():
    """Keep uncertain near spellings separate when neither is a known word."""
    space = infer("<root><zaxv>1</zaxv></root>", "<root><zaxw>1</zaxw></root>")

    assert len(space["nodes"]) == 3


@pytest.mark.parametrize(
    "value, kind",
    [
        ("001", "string"),
        ("1", "integer"),
        ("true", "boolean"),
        ("12.5", "decimal"),
        ("2025-02-29", "string"),
        ("2024-02-29", "date"),
    ],
)
def test_each_value_contributes_to_one_type(value, kind):
    space = infer(f"<value>{value}</value>")

    assert distribution(field(space, "value"), "data_types") == {kind: 1}


def test_limits_and_cycles_are_rejected():
    node = XmlDocumentNode("root")
    node.children.append(node)

    with pytest.raises(NormalizeDocumentsError, match="cycle"):
        normalize_documents([node])

    with pytest.raises(NormalizeDocumentsError, match="max_documents"):
        normalize_documents(
            [XmlDocumentNode("aa"), XmlDocumentNode("bb")],
            InferenceLimits(max_documents=1),
        )


def test_ambiguous_dictionary_aliases_remain_separate():
    from core.processes.match_field_names import match_field_names

    lexicon = LexiconData(
        unigrams={"contact": 1, "customer": 1, "recipient": 1},
        synonym_groups={
            "contact": frozenset(["a", "b"]),
            "customer": frozenset(["a"]),
            "recipient": frozenset(["b"]),
        },
    )
    result = match_field_names([["contact"], ["customer"], ["recipient"]], lexicon)

    assert all(source == target for source, (target, _) in result.items())


def test_production_dictionary_recognizes_price_typo():
    resource = CorpusLexicalResourceTool()
    engine = InferSchema(
        expression_writer=EditorSchemaExpressionWriter(), lexical_resource=resource
    )
    result = serialize_probability_space(
        engine.analyze(
            [
                XmlDocumentNode("order", children=[XmlDocumentNode(name, "100")])
                for name in ("price", "pirce")
            ]
        )
    )

    assert field(result, "order", "price")["typos"][0]["value"] == "pirce"


def test_nested_reordering_preserves_correlations_and_reference_targets():
    """Count reordered nested shapes without merging distinct parent contexts."""
    space = infer(
        "<record><left><aa>1</aa><bb>2</bb></left><right><aa>3</aa></right></record>",
        "<record><right><aa>4</aa></right><left><bb>5</bb><aa>6</aa><aa>7</aa></left></record>",
        "<record><left><cc>8</cc></left><right><dd>9</dd></right></record>",
    )
    nodes = {node["id"]: node for node in space["nodes"]}
    alternatives = field(space, "record")["content"]["alternatives"]
    observed = {}

    for variant in alternatives:
        branches = set()

        for reference in variant["children"]:
            child = nodes[reference["node"]]
            child_variant = next(
                item
                for item in child["content"]["alternatives"]
                if item["id"] == reference["variant"]
            )
            branches.add(
                (
                    child["name"],
                    frozenset(
                        nodes[item["node"]]["name"]
                        for item in child_variant["children"]
                    ),
                )
            )

        observed[frozenset(branches)] = variant["count"]

    assert observed == {
        frozenset([("left", frozenset(["aa", "bb"])), ("right", frozenset(["aa"]))]): 2,
        frozenset([("left", frozenset(["cc"])), ("right", frozenset(["dd"]))]): 1,
    }
    assert field(space, "record", "left", "aa")["occurrences"] == 3
    assert field(space, "record", "left", "aa")["presence_count"] == 2
    assert (
        field(space, "record", "left", "aa")["id"]
        != field(space, "record", "right", "aa")["id"]
    )
