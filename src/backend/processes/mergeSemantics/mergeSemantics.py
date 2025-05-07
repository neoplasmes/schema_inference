from typing import Dict, List

from backend.entities import ElementGrammarInterface
from backend.processes.mergeSemantics.semanticSimilarity import (
    getPairSimilarity,
    getWordListAssociativeSimilarity,
)
from backend.processes.tools.getDictCluster import getDictCluster
from backend.processes.tools.getReferenceEGNameByOccurencies import (
    getReferenceEGNameByOccurencies,
)

# from mergeTypos import TypoMergedElementGrammar

# # key - name to merge, value - reference
# SemanticsDict = Dict[str, str]
NAME_WEIGHT: float = 0.45


def _getCombinedEGSemanticSimilarity(
    eg1: ElementGrammarInterface,
    eg2: ElementGrammarInterface,
) -> float:
    ctx1 = eg1.context
    ctx2 = eg2.context

    # ну вот так
    if ctx1.tag == ctx2.tag:
        return 0.0

    # Мы НЕ мерджим простые элементы со сложными
    if eg1.isSimple != eg2.isSimple:
        # print(eg1.name, eg2.name, "не мерджим вместе точно")

        return 0.0

    nameSimilarity = getPairSimilarity(ctx1.tag, ctx2.tag)
    parentSimilarity = getPairSimilarity(ctx1.parent, ctx2.parent)
    # print(parentSimilarity, ctx1.parent, ctx2.parent)
    if parentSimilarity < 0.7:
        return 0
    # Оба имени простые. true and true = true
    if eg1.isSimple and eg2.isSimple:
        return 0.0

        # if clearCtx1.parent == clearCtx2.parent:
        #     return nameSimilarity

        # parentSimilarity = getPairSimilarity(clearCtx1.parent, clearCtx2.parent)
        # result = NAME_WEIGHT * nameSimilarity + (1 - NAME_WEIGHT) * parentSimilarity

        # return result

    # Сравниваем сложные структуры
    contextSimilarity = getWordListAssociativeSimilarity(
        [*ctx1.children, ctx1.parent], [*ctx2.children, ctx2.parent]
    )

    result = nameSimilarity * NAME_WEIGHT + contextSimilarity * (1 - NAME_WEIGHT)

    # print(
    #     ctx1,
    #     "\n",
    #     ctx2,
    #     "\n",
    #     result,
    #     "\n",
    #     contextSimilarity,
    #     nameSimilarity,
    #     parentSimilarity,
    #     "\n\n\n",
    # )

    return result


def _getSemanticsMetaData(
    clusteredSemantics: Dict[int, List[str]],
    documentGrammar: Dict[str, ElementGrammarInterface],
) -> Dict[str, str]:
    result: Dict[str, str] = {}

    for cluster in clusteredSemantics.values():
        if len(cluster) < 1:
            continue

        referenceEGName = getReferenceEGNameByOccurencies(cluster, documentGrammar)

        for key in cluster:
            if key == referenceEGName:
                continue

            result[key] = referenceEGName

    return result


def mergeSemantics(
    documentGrammar: Dict[str, ElementGrammarInterface],
) -> Dict[str, ElementGrammarInterface]:
    # Параллельный объект для выполнения операций прямо во время итерации по всей грамматике документа
    documentGrammarTemp = {k: v.clone() for k, v in documentGrammar.items()}

    semanticsClusters = getDictCluster(
        documentGrammar, _getCombinedEGSemanticSimilarity, 0.75
    )
    semanticsMetaData = _getSemanticsMetaData(semanticsClusters, documentGrammar)

    for alternativeKey, referenceKey in semanticsMetaData.items():
        if (alternativeKey not in documentGrammar) or (
            referenceKey not in documentGrammar
        ):
            raise Exception("Это че")

        referenceName = referenceKey.split("/")[1]
        alternativeName = alternativeKey.split("/")[1]

        parentToFix = alternativeKey.split("/")[0]

        # Итерируемся по оригинальному объекту, меняем temp
        for grammarKey in documentGrammar:
            if grammarKey.endswith(f"/{parentToFix}"):
                # БАГ
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

                # Удаляем стату по неправильному элементу
                del documentGrammarTemp[grammarKey]

            # мерджим референс и опечатку. обновляем semanticSpace
            if grammarKey.endswith(f"/{alternativeName}"):
                fixedGrammarKey = grammarKey.replace(
                    f"/{alternativeName}", f"/{referenceName}"
                )

                if fixedGrammarKey not in documentGrammar:
                    raise Exception(
                        f"это как. {fixedGrammarKey} - исправленный. {referenceKey} - референс. {alternativeName}"
                    )

                # берём из Temp грамматики, чтобы у нас накапливались альтернативы в случаях,
                # когда их больше одной для элемента))
                trueElement = documentGrammarTemp[fixedGrammarKey]
                falseElement = documentGrammarTemp[grammarKey]

                # в функции mergeEG я прописал сохранение опечаток и альтернатив, поэтому всё долнжо быть нормально???
                trueElement.mergeWith(falseElement)
                documentGrammarTemp[fixedGrammarKey] = trueElement

                documentGrammarTemp[fixedGrammarKey].addSemanticStat(
                    falseElement.context.tag, falseElement.occurencies
                )

                # Удалили корявый элемент
                del documentGrammarTemp[grammarKey]

    return documentGrammarTemp
