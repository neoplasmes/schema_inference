import json
from typing import Dict, List
from xml.etree.ElementTree import ElementTree

from domain.entities import ElementGrammarInterface, ExpressionNode
from domain.ports import (
    DocumentGrammarReader,
    GrammarClusterer,
    Lexicon,
    SemanticSimilarity,
    TextSimilarity,
)
from domain.services.build_expression import generateElementGrammarJSONEntry
from domain.services.merge_semantics import mergeSemantics
from domain.services.merge_typos import mergeTypos


class InferSchema:
    """Build the existing grammar space using interchangeable infrastructure ports."""

    def __init__(
        self,
        *,
        grammar_reader: DocumentGrammarReader,
        lexicon: Lexicon,
        text_similarity: TextSimilarity,
        semantic_similarity: SemanticSimilarity,
        clusterer: GrammarClusterer,
    ):
        self._grammar_reader = grammar_reader
        self._lexicon = lexicon
        self._text_similarity = text_similarity
        self._semantic_similarity = semantic_similarity
        self._clusterer = clusterer

    def execute(self, trees: List[ElementTree]) -> str:
        completedInitialGrammar: Dict[str, ElementGrammarInterface] = {}
        rootName = None

        for tree in trees:
            root = tree.getroot()
            if root is None:
                continue

            if rootName is None:
                rootName = root.tag.lower()
            elif root.tag.lower() != rootName:
                completedInitialGrammar[f"begin-c/{rootName}-c"].addSemanticStat(
                    root.tag, 1
                )
                root.tag = rootName

            documentGrammar = self._grammar_reader.read(root)

            for key, grammar in documentGrammar.items():
                if key not in completedInitialGrammar:
                    completedInitialGrammar[key] = grammar
                else:
                    completedInitialGrammar[key].mergeWith(grammar)

        mergedTyposGrammar = mergeTypos(
            completedInitialGrammar,
            clusterer=self._clusterer,
            lexicon=self._lexicon,
            text_similarity=self._text_similarity,
        )
        mergedSemanticsGrammar = mergeSemantics(
            mergedTyposGrammar,
            clusterer=self._clusterer,
            lexicon=self._lexicon,
            similarity=self._semantic_similarity,
        )

        jsonData = {
            key: generateElementGrammarJSONEntry(grammar)
            for key, grammar in mergedSemanticsGrammar.items()
        }
        return json.dumps(jsonData, default=ExpressionNode.jsonSerializerExtension)
