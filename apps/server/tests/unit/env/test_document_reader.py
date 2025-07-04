from io import BytesIO

from app.use_cases.infer_schema import InferSchema
from main import build_document_reader


def test_yaml_keeps_native_scalar_types():
    reader = build_document_reader()
    root = reader.read(
        BytesIO(b"order: {code: '001', paid: false, note: null}"), "order.yaml"
    )
    nodes = {node["name"]: node for node in InferSchema().analyze([root])["nodes"]}

    assert nodes["code"]["data_types"][0]["value"] == "string"
    assert nodes["paid"]["data_types"][0]["value"] == "boolean"
    assert nodes["note"]["data_types"][0]["value"] == "null"


def test_yaml_order_and_repetition_do_not_add_structures():
    reader = build_document_reader()
    roots = [
        reader.read(BytesIO(source), "order.yaml")
        for source in (
            b"order: {items: [{price: 12}], name: Ann}",
            b"order: {name: Ben, items: [{price: 15}, {price: 20}]}",
        )
    ]
    nodes = {node["name"]: node for node in InferSchema().analyze(roots)["nodes"]}

    assert len(nodes["order"]["content"]["alternatives"]) == 1
    assert len(nodes["items"]["content"]["alternatives"]) == 1
    assert nodes["price"]["occurrences"] == 3
