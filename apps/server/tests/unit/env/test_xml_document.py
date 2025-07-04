from io import BytesIO

import pytest

from app.ports.tools.document_reader import InvalidDocumentError
from app.use_cases.infer_schema import InferSchema
from env.tools.document_reader.strategies import ElementTreeXmlDocumentTool


def test_xml_reader_preserves_text_tail_expanded_names_and_attributes():
    """Keep namespace-qualified names, attributes and mixed text when reading XML."""
    source = BytesIO(
        b'<r:Root xmlns:r="https://Example.org/path-v1/" r:Id="01" Id="02">'
        b"Before<r:child>Inside</r:child>After<empty/>End</r:Root>"
    )
    root = ElementTreeXmlDocumentTool().read(source)

    assert root.tag == "{https://Example.org/path-v1/}Root"
    assert root.attributes == {"{https://Example.org/path-v1/}Id": "01", "Id": "02"}
    assert root.text == "Before"
    assert root.children[0].text == "Inside"
    assert root.children[0].tail == "After"
    assert root.children[1].tail == "End"


def test_namespace_prefix_aliases_have_the_same_profile_identity():
    """Treat different prefixes for the same namespace as the same profile."""
    parser = ElementTreeXmlDocumentTool()
    first = parser.read(
        BytesIO(b'<a:root xmlns:a="urn:orders"><a:item a:id="1"/></a:root>')
    )
    second = parser.read(
        BytesIO(b'<b:root xmlns:b="urn:orders"><b:item b:id="1"/></b:root>')
    )

    first_space = InferSchema().analyze([first])
    second_space = InferSchema().analyze([second])

    assert first_space == second_space
    assert first.namespaces["a"] == second.namespaces["b"] == "urn:orders"


def test_malformed_xml_raises_the_port_error():
    """Expose malformed XML through the document reader's declared error."""
    with pytest.raises(InvalidDocumentError):
        ElementTreeXmlDocumentTool().read(BytesIO(b"<root><item></root>"))


def test_namespace_shadowing_and_default_undeclaration_restore_parent_scope():
    """Limit namespace overrides to their element and its descendants."""
    source = BytesIO(
        b'<root xmlns="urn:default" xmlns:p="urn:outer">'
        b'<p:before/><section xmlns="" xmlns:p="urn:inner">'
        b"<p:inside/><plain/></section><p:after/></root>"
    )
    root = ElementTreeXmlDocumentTool().read(source)
    before, section, after = root.children
    inside, plain = section.children

    assert root.namespaces[""] == "urn:default"
    assert root.namespaces["p"] == "urn:outer"
    assert before.tag == "{urn:outer}before"
    assert after.tag == "{urn:outer}after"
    assert section.tag == "section"
    assert section.namespaces[""] == plain.namespaces[""] == ""
    assert section.namespaces["p"] == inside.namespaces["p"] == "urn:inner"
    assert inside.tag == "{urn:inner}inside"
    assert plain.tag == "plain"
    assert after.namespaces == root.namespaces
    assert "xmlns" not in root.attributes


def test_text_and_tails_survive_small_stream_chunks():
    """Preserve text around child elements even when stream reads split it."""

    class SmallChunks(BytesIO):
        def read(self, size=-1):
            return super().read(3 if size < 0 else min(size, 3))

    root = ElementTreeXmlDocumentTool().read(
        SmallChunks(b'<root xmlns:p="urn:p">before<p:item>inside</p:item>tail</root>')
    )

    assert root.text == "before"
    assert root.children[0].text == "inside"
    assert root.children[0].tail == "tail"
