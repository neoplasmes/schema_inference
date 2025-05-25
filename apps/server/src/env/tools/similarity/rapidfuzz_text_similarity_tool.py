from rapidfuzz import fuzz

from app.ports.tools.text_similarity_tool import TextSimilarity


class RapidFuzzSimilarity(TextSimilarity):
    def compare(self, first: str, second: str) -> float:
        return fuzz.WRatio(first, second) / 100.0
