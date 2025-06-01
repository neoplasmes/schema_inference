import json

from app.ports.tools import ClusteringTool, Lexicon, SemanticSimilarity, TextSimilarity
from core.entities import ElementGrammarInterface, ExpressionNode, XmlNode
from core.processes.aggregate_document_grammar import aggregate_document_grammars
from core.processes.build_expression import generateElementGrammarJSONEntry
from core.processes.merge_semantics import (
    combine_semantic_similarity,
    mergeSemantics,
    prepare_semantic_clustering,
    prepare_semantic_pairs,
    semantic_context_words,
)
from core.processes.merge_typos import (
    abbreviation_words,
    getAbbreviationOrTypoProbability,
    mergeTypos,
    prepare_typo_clustering,
    prepare_typo_pairs,
)
from core.processes.select_reference_grammar import reference_words


class InferSchema:
    """Call external tools and pass their results to pure core processes."""

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

    def _known_words(
        self, grammar: dict[str, ElementGrammarInterface]
    ) -> frozenset[str]:
        return frozenset(
            word for word in reference_words(grammar) if self._lexicon.contains(word)
        )

    def _merge_typos(
        self, grammar: dict[str, ElementGrammarInterface]
    ) -> dict[str, ElementGrammarInterface]:
        scores = {}

        for first, second in prepare_typo_pairs(grammar):
            left, right = grammar[first].context, grammar[second].context
            short_word, long_word = abbreviation_words(left.tag, right.tag)
            relatedness = self._lexicon.relatedness(short_word, long_word)
            text_similarity = self._text_similarity.compare(left.tag, right.tag)
            scores[first, second] = getAbbreviationOrTypoProbability(
                left, right, relatedness, text_similarity
            )

        request = prepare_typo_clustering(grammar, scores)
        clusters = self._clusterer.cluster(request)
        known_words = self._known_words(grammar)

        return mergeTypos(grammar, clusters=clusters, known_words=known_words)

    def _merge_semantics(
        self, grammar: dict[str, ElementGrammarInterface]
    ) -> dict[str, ElementGrammarInterface]:
        scores = {}

        for first, second in prepare_semantic_pairs(grammar):
            left, right = grammar[first], grammar[second]
            name_similarity = self._semantic_similarity.pair(
                left.context.tag, right.context.tag
            )
            context_similarity = self._semantic_similarity.word_lists(
                semantic_context_words(left), semantic_context_words(right)
            )
            scores[first, second] = combine_semantic_similarity(
                name_similarity, context_similarity
            )

        request = prepare_semantic_clustering(grammar, scores)
        clusters = self._clusterer.cluster(request)
        known_words = self._known_words(grammar)

        return mergeSemantics(grammar, clusters=clusters, known_words=known_words)

    def execute(self, roots: list[XmlNode]) -> str:
        initial_grammar = aggregate_document_grammars(roots)
        merged_typos = self._merge_typos(initial_grammar)
        merged_semantics = self._merge_semantics(merged_typos)

        json_data = {
            key: generateElementGrammarJSONEntry(grammar)
            for key, grammar in merged_semantics.items()
        }

        return json.dumps(json_data, default=ExpressionNode.jsonSerializerExtension)
