import json
from typing import List

from app.ports.tools.clustering_tool import ClusteringTool
from app.ports.tools.lexicon_tool import Lexicon
from app.ports.tools.semantic_similarity_tool import SemanticSimilarity
from app.ports.tools.text_similarity_tool import TextSimilarity
from core.entities import ExpressionNode
from core.entities.xml_node import XmlNode
from core.processes.build_expression_proc import generateElementGrammarJSONEntry
from core.processes.document_grammar.aggregate_document_grammar_proc import (
    aggregate_document_grammars,
)
from core.processes.merging.merge_semantics_proc import mergeSemantics
from core.processes.merging.merge_typos_proc import mergeTypos


class InferSchema:
    """Coordinate grammar inference using core processes and application ports."""

    def __init__(
        self,
        *,
        lexicon: Lexicon,
        text_similarity: TextSimilarity,
        semantic_similarity: SemanticSimilarity,
        clusterer: ClusteringTool,
    ):
        self._lexicon = lexicon
        self._text_similarity = text_similarity
        self._semantic_similarity = semantic_similarity
        self._clusterer = clusterer

    def execute(self, roots: List[XmlNode]) -> str:
        completedInitialGrammar = aggregate_document_grammars(roots)
        mergedTyposGrammar = mergeTypos(
            completedInitialGrammar,
            cluster=self._clusterer.cluster,
            contains_word=self._lexicon.contains,
            relatedness=self._lexicon.relatedness,
            compare_text=self._text_similarity.compare,
        )
        mergedSemanticsGrammar = mergeSemantics(
            mergedTyposGrammar,
            cluster=self._clusterer.cluster,
            contains_word=self._lexicon.contains,
            compare_words=self._semantic_similarity.pair,
            compare_word_lists=self._semantic_similarity.word_lists,
        )

        jsonData = {
            key: generateElementGrammarJSONEntry(grammar)
            for key, grammar in mergedSemanticsGrammar.items()
        }
        return json.dumps(jsonData, default=ExpressionNode.jsonSerializerExtension)
