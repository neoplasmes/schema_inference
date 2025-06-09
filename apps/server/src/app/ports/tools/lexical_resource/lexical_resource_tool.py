from typing import Protocol

from core.entities.lexical import LexiconData


class LexicalResourceTool(Protocol):
    """Supply immutable lexical facts without making schema matching decisions."""

    def load(self) -> LexiconData: ...
