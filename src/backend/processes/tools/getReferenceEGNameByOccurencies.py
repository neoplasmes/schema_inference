from typing import Dict, List

from nltk.corpus import wordnet

from backend.entities import ElementGrammarInterface


# TODO: изменить корпус на schema.org
def getReferenceEGNameByOccurencies(
    cluster: List[str], documentGrammar: Dict[str, ElementGrammarInterface]
) -> str:
    """
    Функция для извлечения эталонной грамматики среди кластера. Возвращает
    ключ эталонной грамматики. Эталонная грамматика определяется как наиболее часто используемая.
    Если n > 1 грамматик используется максимальное кол-во раз, будет выбрана та,
    имя которой присутствует в корпусе WordNet.
    Если обе отсутствуют, будет выбрана та, имя которой имеет большую длину.
    """
    # Поиск эталонного элемента
    referenceName: str = ""
    referenceCandidates: list[str] = []

    # Чек на частоту
    maxOccurencies = 0
    for currentGrammarKey in cluster:
        currentOccurencies = documentGrammar[currentGrammarKey].occurencies

        if currentOccurencies > maxOccurencies:
            maxOccurencies = currentOccurencies

            referenceCandidates.clear()
            referenceCandidates.append(currentGrammarKey)

        elif currentOccurencies == maxOccurencies:
            referenceCandidates.append(currentGrammarKey)

    # # Если какие-то элементы имеют одинаковую частоту, равную максимальной то пикаем max длину
    # # Если есть два или более эл-та с длиной = max, то выберется случайный и это логично с точки зрения
    # # текущего подхода
    normalizedByWordNet = referenceCandidates
    if len(referenceCandidates) > 1:
        normalizedByWordNet = [
            x
            for x in referenceCandidates
            if len(wordnet.synsets(x.split("/")[1].split("-")[0])) > 0
        ]

        if len(normalizedByWordNet) == 0:
            normalizedByWordNet = referenceCandidates

    if len(normalizedByWordNet) > 1:
        referenceName = max(normalizedByWordNet, key=lambda x: len(x))
    else:
        referenceName = normalizedByWordNet[0]

    return referenceName
