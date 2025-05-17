from typing import Tuple

from nltk.corpus import wordnet
from rapidfuzz import fuzz

from backend.entities.ElementGrammar.interface import ClearEGContext


def _computeAbbreviationProbability(word1: str, word2: str) -> Tuple[float, bool]:
    # Определяем длинное и короткое слово
    if len(word1) > len(word2):
        long = word1.lower()
        short = word2.lower()
    else:
        long = word2.lower()
        short = word1.lower()

    shortSynsets = wordnet.synsets(short)
    longSynsets = wordnet.synsets(long)
    max_similarity = 0
    foundInWordNet = False
    if shortSynsets and longSynsets:
        for s1 in shortSynsets:
            for s2 in longSynsets:
                similarity = s1.wup_similarity(s2)  # type: ignore
                if similarity and similarity > max_similarity:
                    max_similarity = similarity

    if max_similarity > 0:
        foundInWordNet = True

    # Проверка первой буквы
    if short[0] != long[0]:
        return 0.0, foundInWordNet
    elif short[0] == long[0] and len(short) == 1:
        return 0.2, foundInWordNet

        # if max_similarity < 0.6:  # Порог для "разных" слов
        # return 1.0 if long.startswith(short) else min(0.3, fuzz.ratio(long, short) / 100)
    # Если короткое слово — префикс
    # if long.startswith(short):
    #     return min(1.0, 0.75 + 0.25 * (len(short) / len(long)))

    # Разбиваем составные слова (предполагаем CamelCase)
    long_parts = []
    current_part = ""
    for char in long:
        if char.isupper() and current_part:
            long_parts.append(current_part)
            current_part = char
        else:
            current_part += char
    if current_part:
        long_parts.append(current_part)

    # Находим позиции букв короткого слова в длинном
    positions = []
    long_idx = 0
    for char in short:
        while long_idx < len(long):
            if long[long_idx] == char:
                positions.append(long_idx)
                long_idx += 1
                break
            long_idx += 1
        else:
            positions.append(None)

    found = sum(1 for pos in positions if pos is not None)
    if found < 2:
        return 0.0, foundInWordNet

    # Базовый показатель
    base_score = found / len(short)

    # Проверяем порядок
    valid_positions = [p for p in positions if p is not None]
    inversions = 0
    for i in range(len(valid_positions) - 1):
        if valid_positions[i] > valid_positions[i + 1]:
            inversions += 1
    max_inversions = (found * (found - 1)) / 2
    order_penalty = inversions / (max_inversions + 1) if max_inversions > 0 else 0

    # Плотность с учётом составных слов
    if valid_positions:
        span = max(valid_positions) - min(valid_positions) + 1
        density = min(1.0, found / span * len(long_parts))
    else:
        density = 0.0

    # # Соотношение длин
    # length_ratio = len(short) / len(long)

    # Бонус за согласные
    vowels = set("aeiouy")
    short_consonants = sum(1 for c in short if c not in vowels)
    long_consonants = sum(1 for c in long if c not in vowels)
    consonant_ratio = short_consonants / long_consonants if long_consonants > 0 else 0
    consonant_bonus = 0.25 * consonant_ratio  # Плавный бонус до 0.25

    # Итоговая вероятность
    probability = (
        base_score * (1 - 0.2 * order_penalty) * (0.6 + 0.4 * density) + consonant_bonus
    )

    # Если схожесть больше 0 (условное значение), значит мы столкнулись с парой слов с низким
    # редакционным расстоянием (моим кастомным), но при этом у них есть какое-то значение
    # какой-то "смысл". В общем это реальные слова с разным значением, поэтому мы их обрабатываем
    # по-особенному
    if max_similarity > 0:
        probability = (probability - max_similarity) / 2

    return max(0.0, min(1.0, probability)), foundInWordNet


test_cases = [
    ("persona", "person"),
    ("PurchaseOrder", "POrdr"),
    ("PurchaseOrder", "PrchsOrdr"),
    ("PurchaseOrder", "Purchase"),
    ("Surname", "name"),
    ("Surname", "srnm"),
    ("Salary", "sale"),
    ("Salary", "sal"),
    ("Salary", "slr"),
    ("Salary", "slry"),
    ("Salary", "s"),
    ("international", "inter"),
    ("international", "internal"),
    ("org", "organization"),
    ("football", "foot"),
    ("football", "footage"),
]

# for w1, w2 in test_cases:
#     print(w1, w2,_computeAbbreviationProbability(w1, w2))


# TODO: протестировать x + y - x * y
def getAbbreviationOrTypoProbability(
    ctx1: ClearEGContext, ctx2: ClearEGContext
) -> float:

    if ctx1.tag == ctx2.tag or ctx1.parent != ctx2.parent:
        return 0.0
    # Вероятность сокращения
    abbr_prob, foundInWordnet = _computeAbbreviationProbability(ctx1.tag, ctx2.tag)
    # Иная вероятность опечатки (нормируем WRatio до 0-1)
    typo_prob = fuzz.WRatio(ctx1.tag, ctx2.tag) / 100.0

    if foundInWordnet:
        return abbr_prob

    # x + y - x*y
    # Определяем тип и возвращаем максимальную вероятность
    return typo_prob if abbr_prob <= 0.7 else abbr_prob


# print(getAbbreviationOrTypoProbability("namop", "namop"))  # (~0.67, "typo") или "uncertain" в зависимости от настроек
# print(getAbbreviationOrTypoProbability("PO", "PurchaseOrder"))  # (~0.9, "typo")
# print(getAbbreviationOrTypoProbability("sale", "salary"))
# print(getAbbreviationOrTypoProbability("PurchaseOrdir", "PurchaseOrder"))
# print(getAbbreviationOrTypoProbability("football", "foot"))
# print(getAbbreviationOrTypoProbability("birthdate", "birhtdate"))
# print(getAbbreviationOrTypoProbability("international", "internal"))

# print(getAbbreviationOrTypoProbability("Surname", "name"))
# print(getAbbreviationOrTypoProbability("phone-s_name-c_email-s", "name-s_phone-s_surname-s_email-s"))
