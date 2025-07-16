import json

from app.use_cases.infer_schema import InferSchema
from core.entities import XmlDocumentNode
from core.entities.probability_space import ProbabilitySpace
from env.tools.probability_space import serialize_probability_space
from env.tools.schema_expression import EditorSchemaExpressionWriter


def test_serialized_analysis_is_detached_from_domain_collections():
    inference = InferSchema(expression_writer=EditorSchemaExpressionWriter())
    space = inference.analyze([XmlDocumentNode("name", "value")])
    result = serialize_probability_space(space)
    result["nodes"][0]["path"].clear()
    result["nodes"][0]["data_types"][0]["count"] = -1
    result["nodes"][0]["content"]["alternatives"].clear()

    assert space.nodes[0].path == ("name",)
    assert space.nodes[0].data_types[0].count == 1
    assert len(space.nodes[0].variants) == 1
    assert json.loads(EditorSchemaExpressionWriter().generate(space))["begin-c/name-s"][
        "XSDTypes"
    ] == {"string": 1}


def test_use_case_delegates_presentation_through_the_output_port():
    captured: list[ProbabilitySpace] = []

    class Writer:
        def generate(self, space: ProbabilitySpace) -> str:
            captured.append(space)

            return "presented"

    result = InferSchema(expression_writer=Writer()).execute([XmlDocumentNode("root")])

    assert result == "presented"
    assert len(captured) == 1
    assert isinstance(captured[0], ProbabilitySpace)
    assert captured[0].nodes[0].name == "root"
