from rapidfuzz import fuzz


class RapidFuzzSimilarity:
    def compare(self, first: str, second: str) -> float:
        return fuzz.WRatio(first, second) / 100.0
