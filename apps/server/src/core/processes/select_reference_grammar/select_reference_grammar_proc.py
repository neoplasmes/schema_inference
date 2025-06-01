from typing import Dict, List

from core.entities import ElementGrammarInterface


def reference_words(grammar: dict[str, ElementGrammarInterface]) -> set[str]:
    """Extract the words used to resolve reference grammar ties."""
    return {key.split("/")[1].split("-")[0] for key in grammar}


def getReferenceEGNameByOccurencies(
    cluster: List[str],
    documentGrammar: Dict[str, ElementGrammarInterface],
    known_words: frozenset[str],
) -> str:
    """
    Функция для извлечения эталонной грамматики среди кластера. Возвращает
    ключ эталонной грамматики. Эталонная грамматика определяется как наиболее часто используемая.
    Если n > 1 грамматик используется максимальное кол-во раз, будет выбрана та,
    имя которой присутствует в переданном наборе известных слов.
    При оставшемся равенстве выбирается самый длинный ключ грамматики.
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
            if x.split("/")[1].split("-")[0] in known_words
        ]

        if len(normalizedByWordNet) == 0:
            normalizedByWordNet = referenceCandidates

    if len(normalizedByWordNet) > 1:
        referenceName = max(normalizedByWordNet, key=lambda x: len(x))
    else:
        referenceName = normalizedByWordNet[0]

    return referenceName
