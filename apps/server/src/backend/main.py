import json  # noqa: F401
import xml.etree.ElementTree as ET

from backend.entities import ExpressionNode
from backend.processes import (  # noqa: F401
    generateElementGrammarJSONEntry,
    getDocumentGrammar,
    mergeSemantics,
    mergeTypos,
)

simpleFile = "generated_xml/sample2.xml"
complexFile = "cornerCases/case2complexWithAttributes.xml"

with open(complexFile, "r") as source:
    XMLTree = ET.parse(source)

ig1 = getDocumentGrammar(XMLTree.getroot())

typosMerged = mergeTypos(ig1)

semanticsMerged = mergeSemantics(typosMerged)

jsonPrep = {}
for key in semanticsMerged:
    jsonPrep[key] = generateElementGrammarJSONEntry(semanticsMerged[key])

with open("sample.json", "w") as f:
    json.dump(
        jsonPrep,
        f,
        indent=2,
        ensure_ascii=False,
        default=ExpressionNode.jsonSerializerExtension,
    )
