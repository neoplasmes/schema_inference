import json
from typing import Dict, List
from xml.etree.ElementTree import ElementTree

from backend.entities import ElementGrammarInterface, ExpressionNode
from backend.processes import (
    generateElementGrammarJSONEntry,
    getDocumentGrammar,
    mergeSemantics,
    mergeTypos,
)


def documentGrammarPipeline(trees: List[ElementTree]) -> str:
    completedInitialGrammar: Dict[str, ElementGrammarInterface] = {}

    firstIteration = True
    rootName = None

    for tree in trees:
        root = tree.getroot()
        if root is None:
            continue

        if firstIteration or (rootName is None):
            rootName = root.tag.lower()
        elif root.tag.lower() != rootName:
            completedInitialGrammar[f"begin-c/{rootName}-c"].addSemanticStat(
                root.tag, 1
            )
            root.tag = rootName

        documentGrammar = getDocumentGrammar(root)

        for key, grammar in documentGrammar.items():
            if key not in completedInitialGrammar:
                completedInitialGrammar[key] = grammar
            else:
                completedInitialGrammar[key].mergeWith(grammar)

        firstIteration = False

    mergedTyposGrammar = mergeTypos(completedInitialGrammar)
    print("ок с опечатками")

    mergedSemanticsGrammar = mergeSemantics(mergedTyposGrammar)
    print("ок с семантикой")

    jsonData = {}
    for key in mergedSemanticsGrammar:
        jsonData[key] = generateElementGrammarJSONEntry(mergedSemanticsGrammar[key])

    print("ок с выражениями")

    jsonString = json.dumps(
        jsonData,
        default=ExpressionNode.jsonSerializerExtension,
    )

    print("ок со строкой")

    return jsonString
