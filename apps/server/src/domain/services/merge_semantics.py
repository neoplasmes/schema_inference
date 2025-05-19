from typing import Dict, List

from domain.entities import ElementGrammarInterface
from domain.ports import GrammarClusterer, Lexicon, SemanticSimilarity
from domain.services.reference_grammar import getReferenceEGNameByOccurencies

NAME_WEIGHT: float = 0.45


def _getCombinedEGSemanticSimilarity(
    eg1: ElementGrammarInterface,
    eg2: ElementGrammarInterface,
    similarity: SemanticSimilarity,
) -> float:
    ctx1 = eg1.context
    ctx2 = eg2.context

    if ctx1.tag == ctx2.tag:
        return 0.0

    if eg1.isSimple != eg2.isSimple:

        return 0.0

    nameSimilarity = similarity.pair(ctx1.tag, ctx2.tag)
    if eg1.isSimple and eg2.isSimple or ctx1.parent != ctx2.parent:
        return 0.0


    contextSimilarity = similarity.word_lists(
        [*ctx1.children, ctx1.parent], [*ctx2.children, ctx2.parent]
    )

    result = nameSimilarity * NAME_WEIGHT + contextSimilarity * (1 - NAME_WEIGHT)


    return result


def _getSemanticsMetaData(
    clusteredSemantics: Dict[int, List[str]],
    documentGrammar: Dict[str, ElementGrammarInterface],
    lexicon: Lexicon,
) -> Dict[str, str]:
    result: Dict[str, str] = {}

    for cluster in clusteredSemantics.values():
        if len(cluster) < 1:
            continue

        referenceEGName = getReferenceEGNameByOccurencies(cluster, documentGrammar, lexicon)

        for key in cluster:
            if key == referenceEGName:
                continue

            result[key] = referenceEGName

    return result


def mergeSemantics(
    documentGrammar: Dict[str, ElementGrammarInterface],
    *,
    clusterer: GrammarClusterer,
    lexicon: Lexicon,
    similarity: SemanticSimilarity,
) -> Dict[str, ElementGrammarInterface]:
    documentGrammarTemp = {k: v.clone() for k, v in documentGrammar.items()}

    semanticsClusters = clusterer.cluster(
        documentGrammar,
        lambda first, second: _getCombinedEGSemanticSimilarity(first, second, similarity),
        0.75,
    )
    semanticsMetaData = _getSemanticsMetaData(semanticsClusters, documentGrammar, lexicon)

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
