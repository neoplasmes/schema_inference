from app.ports.tools import SemanticSimilarity


class NoopSemanticSimilarity(SemanticSimilarity):
    """Disable semantic merging while preserving the scorer port."""

    def pair(self, first: str, second: str) -> float:
        return 0.0

    def word_lists(self, first: list[str], second: list[str]) -> float:
        return 0.0
