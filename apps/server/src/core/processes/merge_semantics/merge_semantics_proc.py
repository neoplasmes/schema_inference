from itertools import combinations
from typing import Dict, List

from core.entities import ElementGrammarInterface, GrammarClustering
from core.processes.select_reference_grammar import getReferenceEGNameByOccurencies

NAME_WEIGHT: float = 0.45


def semantic_context_words(grammar: ElementGrammarInterface) -> list[str]:
    """Use child names and the parent name as semantic context."""
    context = grammar.context

    return [*context.children, context.parent]


def prepare_semantic_pairs(
    grammar: dict[str, ElementGrammarInterface],
) -> list[tuple[str, str]]:
    """Select complex grammars with different tags and the same parent."""
    pairs = []

    for second, first in combinations(grammar, 2):
        left, right = grammar[first], grammar[second]

        if (
            left.context.tag != right.context.tag
            and not left.isSimple
            and not right.isSimple
            and left.context.parent == right.context.parent
        ):
            pairs.append((first, second))

    return pairs


def combine_semantic_similarity(
    name_similarity: float, context_similarity: float
) -> float:
    """Weight the external name and context scores using the domain rule."""
    return name_similarity * NAME_WEIGHT + context_similarity * (1 - NAME_WEIGHT)


def prepare_semantic_clustering(
    grammar: dict[str, ElementGrammarInterface],
    scores: dict[tuple[str, str], float],
) -> GrammarClustering:
    """Apply the semantic grouping policy to the calculated pair scores."""
    return GrammarClustering.from_pair_scores(
        tuple(grammar), scores, threshold=0.75, linkage="average"
    )


def _getSemanticsMetaData(
    clusteredSemantics: Dict[int, List[str]],
    documentGrammar: Dict[str, ElementGrammarInterface],
    known_words: frozenset[str],
) -> Dict[str, str]:
    result: Dict[str, str] = {}

    for cluster in clusteredSemantics.values():
        if len(cluster) < 1:
            continue

        referenceEGName = getReferenceEGNameByOccurencies(
            cluster, documentGrammar, known_words
        )

        for key in cluster:
            if key == referenceEGName:
                continue

            result[key] = referenceEGName

    return result


def mergeSemantics(
    documentGrammar: Dict[str, ElementGrammarInterface],
    *,
    clusters: dict[int, list[str]],
    known_words: frozenset[str],
) -> Dict[str, ElementGrammarInterface]:
    documentGrammarTemp = {k: v.clone() for k, v in documentGrammar.items()}
    semanticsMetaData = _getSemanticsMetaData(clusters, documentGrammar, known_words)

    for alternativeKey, referenceKey in semanticsMetaData.items():
        if (alternativeKey not in documentGrammar) or (
            referenceKey not in documentGrammar
        ):
            raise Exception("Это че")

        referenceName = referenceKey.split("/")[1]
        alternativeName = alternativeKey.split("/")[1]

        parentToFix = alternativeKey.split("/")[0]

        for grammarKey in documentGrammar:
            if grammarKey.endswith(f"/{parentToFix}"):
                if grammarKey in documentGrammarTemp:
                    documentGrammarTemp[grammarKey].replaceTagInStats(
                        alternativeName, referenceName
                    )

            if grammarKey.startswith(f"{alternativeName}/"):
                fixedGrammarKey = grammarKey.replace(
                    f"{alternativeName}/", f"{referenceName}/"
                )

                if fixedGrammarKey in documentGrammar:
                    documentGrammarTemp[fixedGrammarKey].mergeWith(
                        documentGrammar[grammarKey]
                    )
                else:
                    documentGrammarTemp[fixedGrammarKey] = documentGrammarTemp[
                        grammarKey
                    ]

                del documentGrammarTemp[grammarKey]

            if grammarKey.endswith(f"/{alternativeName}"):
                fixedGrammarKey = grammarKey.replace(
                    f"/{alternativeName}", f"/{referenceName}"
                )

                if fixedGrammarKey not in documentGrammar:
                    raise Exception(
                        f"это как. {fixedGrammarKey} - исправленный. {referenceKey} - референс. {alternativeName}"
                    )

                trueElement = documentGrammarTemp[fixedGrammarKey]
                falseElement = documentGrammarTemp[grammarKey]

                trueElement.mergeWith(falseElement)
                documentGrammarTemp[fixedGrammarKey] = trueElement

                documentGrammarTemp[fixedGrammarKey].addSemanticStat(
                    falseElement.context.tag, falseElement.occurencies
                )

                del documentGrammarTemp[grammarKey]

    return documentGrammarTemp
