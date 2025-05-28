from functools import lru_cache
from pathlib import Path

from app.ports.tools.lexicon_error import LexiconError
from app.ports.tools.lexicon_tool import Lexicon


@lru_cache(maxsize=8192)
def _synsets(word: str, data_path: Path | None):
    from nltk import data
    from nltk.corpus import wordnet

    if data_path is not None:
        path = str(data_path)
        if path not in data.path:
            data.path.insert(0, path)

    try:
        return tuple(synset for synset in wordnet.synsets(word) if synset is not None)
    except LookupError as error:
        raise LexiconError(
            "WordNet corpus is missing. Run moon run server:download-wordnet."
        ) from error


@lru_cache(maxsize=8192)
def _relatedness(first: str, second: str, data_path: Path | None) -> float:
    similarities = (
        left.wup_similarity(right) or 0.0
        for left in _synsets(first, data_path)
        for right in _synsets(second, data_path)
    )
    return max(similarities, default=0.0)


class WordNetLexicon(Lexicon):
    """Read lexical relations from the locally installed WordNet corpus."""

    def __init__(self, data_path: Path | None = None):
        self._data_path = data_path

    def contains(self, word: str) -> bool:
        return bool(_synsets(word, self._data_path))

    def relatedness(self, first: str, second: str) -> float:
        return _relatedness(first, second, self._data_path)
