import pytest

from core.entities import XmlNode
from core.processes.observe_documents import ObserveDocumentsError, observe_documents


def test_namespace_context_is_an_immutable_snapshot():
    root = XmlNode("root", namespaces={"t": "urn:original"})
    corpus = observe_documents([root])
    root.namespaces["t"] = "urn:changed"

    assert corpus.observations[0].namespaces == (("t", "urn:original"),)


def test_namespace_declaration_order_does_not_change_identity():
    first = XmlNode("root", namespaces={"a": "urn:a", "b": "urn:b"})
    second = XmlNode("root", namespaces={"b": "urn:b", "a": "urn:a"})

    assert observe_documents([first]) == observe_documents([second])


def test_child_builder_inherits_a_copy_of_available_bindings():
    root = XmlNode("root", namespaces={"t": "urn:original"})
    child = root.add_child("child")
    root.namespaces["t"] = "urn:changed"

    assert child.namespaces == {"t": "urn:original"}


@pytest.mark.parametrize("bindings", [None, [], {"t": 1}, {1: "urn:target"}])
def test_invalid_namespace_context_is_rejected(bindings):
    with pytest.raises(ObserveDocumentsError, match="Namespace bindings"):
        observe_documents([XmlNode("root", namespaces=bindings)])
