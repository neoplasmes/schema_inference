from functools import lru_cache
from pathlib import Path
from typing import Optional


class WordNetLexicon:
    """Read lexical relations from the locally installed WordNet corpus."""

    def __init__(self, data_path: Optional[Path] = None):
        self._data_path = data_path

    @lru_cache(maxsize=8192)
    def _synsets(self, word: str):
        from nltk import data
        from nltk.corpus import wordnet

        if self._data_path is not None:
            path = str(self._data_path)
            if path not in data.path:
                data.path.insert(0, path)

        try:
            return tuple(wordnet.synsets(word))
        except LookupError as error:
            raise RuntimeError(
                "WordNet corpus is missing. Run moon run server:download-wordnet."
            ) from error

    def contains(self, word: str) -> bool:
        return bool(self._synsets(word))

    @lru_cache(maxsize=8192)
    def relatedness(self, first: str, second: str) -> float:
        similarities = (
            left.wup_similarity(right) or 0.0
            for left in self._synsets(first)
            for right in self._synsets(second)
        )
        return max(similarities, default=0.0)
