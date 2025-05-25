from typing import Protocol


class TextSimilarity(Protocol):
    def compare(self, first: str, second: str) -> float: ...
