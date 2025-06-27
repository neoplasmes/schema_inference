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


def test_namespace_prefix_aliases_have_the_same_profile_identity():
    parser = ElementTreeXmlDocumentTool()
    first = parser.read(
        BytesIO(b'<a:root xmlns:a="urn:orders"><a:item a:id="1"/></a:root>')
    )
    second = parser.read(
        BytesIO(b'<b:root xmlns:b="urn:orders"><b:item b:id="1"/></b:root>')
    )

    first_corpus = observe_documents([first])
    second_corpus = observe_documents([second])

    assert [profile.profile_id for profile in first_corpus.profiles] == [
        profile.profile_id for profile in second_corpus.profiles
    ]
    assert [profile.path for profile in first_corpus.profiles] == [
        profile.path for profile in second_corpus.profiles
    ]
    assert first.namespaces["a"] == second.namespaces["b"] == "urn:orders"
    assert (
        first_corpus.documents[0].content_hash
        != second_corpus.documents[0].content_hash
    )


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


def test_namespace_shadowing_and_default_undeclaration_restore_parent_scope():
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


def test_qname_attribute_values_keep_their_different_namespace_targets():
    parser = ElementTreeXmlDocumentTool()
    roots = [
        parser.read(
            BytesIO(
                (
                    '<root xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
                    f'xmlns:t="urn:{namespace}" xsi:type="t:Record"/>'
                ).encode()
            )
        )
        for namespace in ("first", "second")
    ]
    corpus = observe_documents(roots)

    assert len(corpus.profiles) == 1
    assert len({document.content_hash for document in corpus.documents}) == 2
    assert {dict(item.namespaces)["t"] for item in corpus.observations} == {
        "urn:first",
        "urn:second",
    }
    assert {item.attributes[0].value for item in corpus.observations} == {"t:Record"}


def test_implicit_xml_namespace_is_available_for_qname_values():
    root = ElementTreeXmlDocumentTool().read(BytesIO(b'<root xml:lang="en"/>'))

    assert root.namespaces["xml"] == "http://www.w3.org/XML/1998/namespace"
    assert root.attributes == {"{http://www.w3.org/XML/1998/namespace}lang": "en"}


def test_sibling_namespace_maps_are_independent():
    root = ElementTreeXmlDocumentTool().read(
        BytesIO(b'<root xmlns:p="urn:original"><first/><second/></root>')
    )
    root.children[0].namespaces["p"] = "urn:changed"

    assert root.namespaces["p"] == "urn:original"
    assert root.children[1].namespaces["p"] == "urn:original"


def test_text_and_tails_survive_small_stream_chunks():
    class SmallChunks(BytesIO):
        def read(self, size=-1):
            return super().read(3 if size < 0 else min(size, 3))

    root = ElementTreeXmlDocumentTool().read(
        SmallChunks(b'<root xmlns:p="urn:p">before<p:item>inside</p:item>tail</root>')
    )

    assert root.text == "before"
    assert root.children[0].text == "inside"
    assert root.children[0].tail == "tail"
