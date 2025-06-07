from io import BytesIO

import pytest

from app.ports.tools import InvalidDocumentError
from core.processes.observe_documents import observe_documents
from env.tools.xml import ElementTreeXmlDocumentTool


def test_xml_reader_preserves_text_tail_expanded_names_and_attributes():
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


def test_namespace_prefix_aliases_have_the_same_expanded_observations():
    parser = ElementTreeXmlDocumentTool()
    first = parser.read(
        BytesIO(b'<a:root xmlns:a="urn:orders"><a:item a:id="1"/></a:root>')
    )
    second = parser.read(
        BytesIO(b'<b:root xmlns:b="urn:orders"><b:item b:id="1"/></b:root>')
    )

    assert observe_documents([first]) == observe_documents([second])


def test_default_namespace_does_not_apply_to_unprefixed_attributes():
    root = ElementTreeXmlDocumentTool().read(
        BytesIO(b'<root xmlns="urn:orders" id="1"><item/></root>')
    )

    assert root.tag == "{urn:orders}root"
    assert root.children[0].tag == "{urn:orders}item"
    assert root.attributes == {"id": "1"}


def test_malformed_xml_raises_the_port_error():
    with pytest.raises(InvalidDocumentError):
        ElementTreeXmlDocumentTool().read(BytesIO(b"<root><item></root>"))
