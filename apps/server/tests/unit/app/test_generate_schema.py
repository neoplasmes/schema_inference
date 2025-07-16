import asyncio
import json
from typing import Any
from xml.etree import ElementTree

import pytest
from fastapi import APIRouter, HTTPException, Request
from fastapi.routing import APIRoute

from api.http.schema import register_xsd
from app.use_cases.generate_schema import GenerateSchema, GenerateSchemaError
from env.tools.schema import ElementTreeSchemaWriterTool


class RecordingWriter:
    def __init__(self):
        self.calls = 0

    def generate(self, root):
        self.calls += 1

        return "unexpected"


@pytest.mark.parametrize(
    "schema",
    [
        {},
        {"name": "x"},
        {"name": "x", "chosenType": "unknown"},
        {"name": "x", "chosenType": "string", "minOccurs": 2, "maxOccurs": 1},
        {"name": "x", "chosenType": "string", "children": [None]},
        {"name": "x", "chosenType": "parent", "children": {}},
        {"name": "x", "chosenType": "string", "attributes": []},
        {"name": "x", "chosenType": "string", "type": "OR"},
        {
            "name": "x",
            "chosenType": "string",
            "children": [{"name": "child", "chosenType": "integer"}],
        },
    ],
)
def test_invalid_selection_never_reaches_writer(schema):
    writer = RecordingWriter()

    with pytest.raises(GenerateSchemaError):
        GenerateSchema(writer).execute(schema)

    assert writer.calls == 0


def test_legacy_editor_selection_is_translated_to_validated_domain_data():
    schema = {
        "name": "root",
        "chosenType": "parent",
        "type": "LEAF",
        "children": [{"name": "name", "chosenType": "empty", "minOccurs": 0}],
    }
    result = GenerateSchema(ElementTreeSchemaWriterTool()).execute(schema)
    root = ElementTree.fromstring(result)
    sequence = root.find(".//{http://www.w3.org/2001/XMLSchema}sequence")
    assert sequence is not None
    element = sequence[0]

    assert element.attrib["nillable"] == "true"
    assert element.attrib["type"] == "xs:string"
    assert element.attrib["minOccurs"] == "0"


def test_invalid_selection_is_reported_as_http_422():
    writer = RecordingWriter()
    router = APIRouter()
    register_xsd(router, GenerateSchema(writer))
    route = next(route for route in router.routes if isinstance(route, APIRoute))

    async def receive() -> dict[str, Any]:
        return {"type": "http.request", "body": json.dumps({}).encode()}

    request = Request(
        {"type": "http", "method": "POST", "path": "/xsd", "headers": []}, receive
    )

    with pytest.raises(HTTPException) as failure:
        asyncio.run(route.endpoint(request))

    assert failure.value.status_code == 422
    assert "name" in failure.value.detail
    assert writer.calls == 0
