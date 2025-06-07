from io import BytesIO

import pytest

from app.ports.tools import InvalidDocumentError
from env.tools.xml import ElementTreeXmlDocumentTool


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



def test_malformed_xml_raises_the_port_error():
    """Expose malformed XML through the document reader's declared error."""
    with pytest.raises(InvalidDocumentError):
        ElementTreeXmlDocumentTool().read(BytesIO(b"<root><item></root>"))



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
