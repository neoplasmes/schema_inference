from typing import Protocol


class SemanticSimilarity(Protocol):
    def pair(self, first: str, second: str) -> float: ...

    def word_lists(self, first: list[str], second: list[str]) -> float: ...
