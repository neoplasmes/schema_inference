from typing import Dict, List

from domain.ports import Lexicon

from domain.entities import ElementGrammarInterface


def getReferenceEGNameByOccurencies(
    cluster: List[str], documentGrammar: Dict[str, ElementGrammarInterface], lexicon: Lexicon
) -> str:
    """
    Функция для извлечения эталонной грамматики среди кластера. Возвращает
    ключ эталонной грамматики. Эталонная грамматика определяется как наиболее часто используемая.
    Если n > 1 грамматик используется максимальное кол-во раз, будет выбрана та,
    имя которой присутствует в корпусе WordNet.
    Если обе отсутствуют, будет выбрана та, имя которой имеет большую длину.
    """
    referenceName: str = ""
    referenceCandidates: list[str] = []

    maxOccurencies = 0
    for currentGrammarKey in cluster:
        currentOccurencies = documentGrammar[currentGrammarKey].occurencies

        if currentOccurencies > maxOccurencies:
            maxOccurencies = currentOccurencies

            referenceCandidates.clear()
            referenceCandidates.append(currentGrammarKey)

        elif currentOccurencies == maxOccurencies:
            referenceCandidates.append(currentGrammarKey)

    normalizedByWordNet = referenceCandidates
    if len(referenceCandidates) > 1:
        normalizedByWordNet = [
            x
            for x in referenceCandidates
            if lexicon.contains(x.split("/")[1].split("-")[0])
        ]

        if len(normalizedByWordNet) == 0:
            normalizedByWordNet = referenceCandidates

    if len(normalizedByWordNet) > 1:
        referenceName = max(normalizedByWordNet, key=lambda x: len(x))
    else:
        referenceName = normalizedByWordNet[0]

    return referenceName
