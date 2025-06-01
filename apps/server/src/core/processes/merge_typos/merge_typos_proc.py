from itertools import combinations
from typing import Dict, List

from core.entities import ElementGrammarInterface, GrammarClustering
from core.processes.select_reference_grammar import getReferenceEGNameByOccurencies


def prepare_typo_pairs(
    grammar: dict[str, ElementGrammarInterface],
) -> list[tuple[str, str]]:
    """Select comparable tags in the legacy comparison order."""
    pairs = []

    for second, first in combinations(grammar, 2):
        left, right = grammar[first].context, grammar[second].context

        if left.tag != right.tag and left.parent == right.parent:
            pairs.append((first, second))

    return pairs


def prepare_typo_clustering(
    grammar: dict[str, ElementGrammarInterface],
    scores: dict[tuple[str, str], float],
) -> GrammarClustering:
    """Apply the typo grouping policy to the calculated pair scores."""
    return GrammarClustering.from_pair_scores(
        tuple(grammar), scores, threshold=0.8, linkage="average"
    )


def _getTyposMetaData(
    clusteredTypos: Dict[int, List[str]],
    documentGrammar: Dict[str, ElementGrammarInterface],
    known_words: frozenset[str],
) -> Dict[str, str]:
    """
    Функция извлекает словарь типа
    <опечатка>: <оригинал>
    """
    result: Dict[str, str] = {}

    for cluster in clusteredTypos.values():
        if len(cluster) <= 1:
            continue

        referenceEGName = getReferenceEGNameByOccurencies(
            cluster, documentGrammar, known_words
        )

        for key in cluster:
            if key == referenceEGName:
                continue

            result[key] = referenceEGName

    return result


def mergeTypos(
    documentGrammar: Dict[str, ElementGrammarInterface],
    *,
    clusters: dict[int, list[str]],
    known_words: frozenset[str],
) -> Dict[str, ElementGrammarInterface]:
    documentGrammarTemp = {k: v.clone() for k, v in documentGrammar.items()}
    typosMetaData = _getTyposMetaData(clusters, documentGrammar, known_words)

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
