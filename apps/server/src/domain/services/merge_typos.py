from typing import Any, Dict, List

from domain.entities import ElementGrammarInterface
from domain.ports import GrammarClusterer, Lexicon, TextSimilarity
from domain.services.typo_similarity import getAbbreviationOrTypoProbability
from domain.services.reference_grammar import getReferenceEGNameByOccurencies


def _getTyposMetaData(
    clusteredTypos: Dict[Any, List[str]],
    documentGrammar: Dict[str, ElementGrammarInterface],
    lexicon: Lexicon,
) -> Dict[str, str]:
    """
    Функция извлекает словарь типа
    <опечатка>: <оригинал>
    """
    result: Dict[str, str] = {}

    for cluster in clusteredTypos.values():
        if len(cluster) <= 1:
            continue

        referenceEGName = getReferenceEGNameByOccurencies(cluster, documentGrammar, lexicon)

        for key in cluster:
            if key == referenceEGName:
                continue

            result[key] = referenceEGName

    return result


def mergeTypos(
    documentGrammar: Dict[str, ElementGrammarInterface],
    *,
    clusterer: GrammarClusterer,
    lexicon: Lexicon,
    text_similarity: TextSimilarity,
) -> Dict[str, ElementGrammarInterface]:
    documentGrammarTemp = {k: v.clone() for k, v in documentGrammar.items()}

    typosClusters = clusterer.cluster(
        documentGrammar,
        lambda eg1, eg2: getAbbreviationOrTypoProbability(
            eg1.context, eg2.context, lexicon, text_similarity
        ),
        0.8,
    )
    typosMetaData = _getTyposMetaData(typosClusters, documentGrammar, lexicon)

    for typoKey, referenceKey in typosMetaData.items():
        if (typoKey not in documentGrammar) or (referenceKey not in documentGrammar):
            raise Exception("Это че")

        referenceName = referenceKey.split("/")[1]
        typoName = typoKey.split("/")[1]

        parentToFix = typoKey.split("/")[0]

        for grammarKey in documentGrammar:
            check = grammarKey.replace(f"/{typoName}", f"/{referenceName}")
            if (
                check not in documentGrammarTemp
                or grammarKey not in documentGrammarTemp
            ):
                continue
            if grammarKey.endswith(f"/{parentToFix}"):
                documentGrammarTemp[grammarKey].replaceTagInStats(
                    typoName, referenceName
                )

            if grammarKey.startswith(f"{typoName}/"):
                fixedGrammarKey = grammarKey.replace(
                    f"{typoName}/", f"{referenceName}/"
                )

                if fixedGrammarKey in documentGrammar:
                    documentGrammarTemp[fixedGrammarKey].mergeWith(
                        documentGrammarTemp[grammarKey]
                    )
                else:
                    documentGrammarTemp[fixedGrammarKey] = documentGrammarTemp[
                        grammarKey
                    ]

                del documentGrammarTemp[grammarKey]

            if grammarKey.endswith(f"/{typoName}"):
                fixedGrammarKey = grammarKey.replace(
                    f"/{typoName}", f"/{referenceName}"
                )

                currentGrammarKeyParent = fixedGrammarKey.split("/")[0]

                helper = {
                    k.split("/")[1]: v.split("/")[1] for k, v in typosMetaData.items()
                }

                if currentGrammarKeyParent in helper:
                    fixedGrammarKey = (
                        f"{helper[currentGrammarKeyParent]}/{referenceName}"
                    )

                if fixedGrammarKey not in documentGrammar:
                    raise Exception(
                        f"unprocessable logic during typos merge. attempt to merge {fixedGrammarKey} and {referenceKey}"
                    )

                trueElement = documentGrammarTemp[fixedGrammarKey]

                falseElKey = grammarKey
                falseParent = grammarKey.split("/")[0]
                if grammarKey not in documentGrammarTemp and falseParent in helper:
                    falseElKey = f"{helper[falseParent]}/{typoName}"

                falseElement = documentGrammarTemp[falseElKey]

                trueElement.mergeWith(falseElement).addTypoStat(
                    falseElement.context.tag, falseElement.occurencies
                )

                del documentGrammarTemp[grammarKey]

    return documentGrammarTemp
