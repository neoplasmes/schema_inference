from typing import Tuple

from core.entities import ClearEGContext


def abbreviation_words(word1: str, word2: str) -> tuple[str, str]:
    """Prepare the short and long words for the lexical lookup."""
    if len(word1) > len(word2):
        return word2.lower(), word1.lower()

    return word1.lower(), word2.lower()


def _computeAbbreviationProbability(
    word1: str, word2: str, lexical_relatedness: float
) -> Tuple[float, bool]:
    short, long = abbreviation_words(word1, word2)

    max_similarity = lexical_relatedness
    foundInWordNet = False

    if max_similarity > 0:
        foundInWordNet = True

    if short[0] != long[0]:
        return 0.0, foundInWordNet
    elif short[0] == long[0] and len(short) == 1:
        return 0.2, foundInWordNet

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

    base_score = found / len(short)

    valid_positions = [p for p in positions if p is not None]
    inversions = 0
    for i in range(len(valid_positions) - 1):
        if valid_positions[i] > valid_positions[i + 1]:
            inversions += 1
    max_inversions = (found * (found - 1)) / 2
    order_penalty = inversions / (max_inversions + 1) if max_inversions > 0 else 0

    if valid_positions:
        span = max(valid_positions) - min(valid_positions) + 1
        density = min(1.0, found / span * len(long_parts))
    else:
        density = 0.0

    vowels = set("aeiouy")
    short_consonants = sum(1 for c in short if c not in vowels)
    long_consonants = sum(1 for c in long if c not in vowels)
    consonant_ratio = short_consonants / long_consonants if long_consonants > 0 else 0
    consonant_bonus = 0.25 * consonant_ratio

    probability = (
        base_score * (1 - 0.2 * order_penalty) * (0.6 + 0.4 * density) + consonant_bonus
    )

    if max_similarity > 0:
        probability = (probability - max_similarity) / 2

    return max(0.0, min(1.0, probability)), foundInWordNet


def getAbbreviationOrTypoProbability(
    ctx1: ClearEGContext,
    ctx2: ClearEGContext,
    lexical_relatedness: float,
    text_similarity: float,
) -> float:
    if ctx1.tag == ctx2.tag or ctx1.parent != ctx2.parent:
        return 0.0
    abbr_prob, foundInWordnet = _computeAbbreviationProbability(
        ctx1.tag, ctx2.tag, lexical_relatedness
    )
    typo_prob = text_similarity

    if foundInWordnet:
        return abbr_prob

    return typo_prob if abbr_prob <= 0.7 else abbr_prob
