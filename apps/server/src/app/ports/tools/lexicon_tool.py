from typing import Protocol


class Lexicon(Protocol):
    def contains(self, word: str) -> bool: ...

    def relatedness(self, first: str, second: str) -> float: ...
