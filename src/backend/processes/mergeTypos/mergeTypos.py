from typing import Any, Dict, List

from backend.entities import ElementGrammarInterface
from backend.processes.mergeTypos.typoOrAbbreviationProbability import (
    getAbbreviationOrTypoProbability,
)
from backend.processes.tools.getDictCluster import getDictCluster
from backend.processes.tools.getReferenceEGNameByOccurencies import (
    getReferenceEGNameByOccurencies,
)


def _getTyposMetaData(
    clusteredTypos: Dict[Any, List[str]],
    documentGrammar: Dict[str, ElementGrammarInterface],
) -> Dict[str, str]:
    """
    Функция извлекает словарь типа
    <опечатка>: <оригинал>
    """
    result: Dict[str, str] = {}

    for cluster in clusteredTypos.values():
        if len(cluster) <= 1:
            continue

        referenceEGName = getReferenceEGNameByOccurencies(cluster, documentGrammar)

        for key in cluster:
            if key == referenceEGName:
                continue

            result[key] = referenceEGName

    return result


def mergeTypos(
    documentGrammar: Dict[str, ElementGrammarInterface],
) -> Dict[str, ElementGrammarInterface]:
    # Независимая копия исходной DocumentGrammar
    documentGrammarTemp = {k: v.clone() for k, v in documentGrammar.items()}

    typosClusters = getDictCluster(
        documentGrammar,
        lambda eg1, eg2: getAbbreviationOrTypoProbability(eg1.context, eg2.context),
        0.8,
    )
    typosMetaData = _getTyposMetaData(typosClusters, documentGrammar)

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
            # Пофиксили родителей
            if grammarKey.endswith(f"/{parentToFix}"):
                documentGrammarTemp[grammarKey].replaceTagInStats(
                    typoName, referenceName
                )

            # фиксим дочек
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

                # Удаляем стату по неправильному элементу
                del documentGrammarTemp[grammarKey]

            # мерджим референс и опечатку. обновляем typoSpace
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

                print(typoName, referenceName, fixedGrammarKey)

                if fixedGrammarKey not in documentGrammar:
                    raise Exception(
                        f"unprocessable logic during typos merge. attempt to merge {fixedGrammarKey} and {referenceKey}"
                    )

                # берём из Temp грамматики, чтобы у нас накапливались опечатки в случаях,
                # когда их больше одной для элемента))
                trueElement = documentGrammarTemp[fixedGrammarKey]

                falseElKey = grammarKey
                falseParent = grammarKey.split("/")[0]
                if grammarKey not in documentGrammarTemp and falseParent in helper:
                    falseElKey = f"{helper[falseParent]}/{typoName}"

                falseElement = documentGrammarTemp[falseElKey]

                # в функции mergeEG я прописал сохранение опечаток и альтернатив, поэтому всё долнжо быть нормально???
                trueElement.mergeWith(falseElement).addTypoStat(
                    falseElement.context.tag, falseElement.occurencies
                )

                # Удалили корявый элемент
                del documentGrammarTemp[grammarKey]

    return documentGrammarTemp
