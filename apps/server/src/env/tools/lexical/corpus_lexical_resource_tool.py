import json
from collections import defaultdict
from functools import lru_cache
from hashlib import sha256
from importlib import resources
from pathlib import Path
from zipfile import ZipFile

from core.entities.lexical import LexiconData


def _frequencies() -> tuple[dict[str, float], dict[tuple[str, str], float]]:
    directory = resources.files("wordsegment")
    unigrams = {}
    bigrams = {}

    with directory.joinpath("unigrams.txt").open(encoding="utf-8") as source:
        for line in source:
            word, count = line.rstrip().split("\t")

            if word.isalpha():
                unigrams[word] = float(count)

    with directory.joinpath("bigrams.txt").open(encoding="utf-8") as source:
        for line in source:
            phrase, count = line.rstrip().split("\t")
            words = phrase.split()

            if len(words) == 2:
                bigrams[(words[0], words[1])] = float(count)

    return unigrams, bigrams


def _wordnet(
    directory: Path,
) -> tuple[dict[str, set[str]], set[tuple[str, str]], str | None]:
    archive = directory / "corpora" / "wordnet.zip"

    if not archive.is_file():
        return {}, set(), "wordnet_unavailable"

    if (
        sha256(archive.read_bytes()).hexdigest()
        != "cbda5ea6eef7f36a97a43d4a75f85e07fccbb4f23657d27b4ccbc93e2646ab59"
    ):
        return {}, set(), "wordnet_checksum_mismatch"

    groups: dict[str, set[str]] = defaultdict(set)
    opposites = set()
    synsets: dict[tuple[str, str], tuple[str, ...]] = {}
    antonyms: list[tuple[tuple[str, str], str, str, str]] = []

    with ZipFile(archive) as corpus:
        for part in ("noun", "verb", "adj", "adv"):
            with corpus.open("wordnet/data." + part) as source:
                for raw in source:
                    if not raw[:1].isdigit():
                        continue

                    fields = raw.decode("ascii").split("|", 1)[0].split()
                    offset, _, kind, word_count = fields[:4]
                    kind = "a" if kind == "s" else kind
                    count = int(word_count, 16)
                    key = (kind, offset)
                    names = tuple(
                        fields[4 + index * 2]
                        .split("(", 1)[0]
                        .replace("_", " ")
                        .casefold()
                        for index in range(count)
                    )
                    synsets[key] = names
                    pointer_start = 4 + count * 2
                    pointer_count = int(fields[pointer_start])

                    for name in names:
                        groups[name].add("wordnet:" + kind + ":" + offset)

                    for index in range(pointer_count):
                        start = pointer_start + 1 + index * 4
                        symbol, target, target_kind, indices = fields[start : start + 4]

                        if symbol == "!":
                            antonyms.append((key, target, target_kind, indices))

        for part in ("noun", "verb", "adj", "adv"):
            with corpus.open("wordnet/" + part + ".exc") as source:
                for raw in source:
                    inflected, *bases = raw.decode("ascii").strip().split()

                    for base in bases:
                        groups[inflected.replace("_", " ")].update(
                            groups.get(base.replace("_", " "), ())
                        )

    for key, target, target_kind, indices in antonyms:
        source_index = int(indices[:2], 16) - 1
        target_index = int(indices[2:], 16) - 1
        target_key = ("a" if target_kind == "s" else target_kind, target)

        if source_index >= 0 and target_index >= 0 and target_key in synsets:
            opposites.add(
                tuple(
                    sorted(
                        (synsets[key][source_index], synsets[target_key][target_index])
                    )
                )
            )

    return dict(groups), opposites, None


@lru_cache(maxsize=4)
def _load(
    directory: Path, include_wordnet: bool, include_word_frequencies: bool
) -> LexiconData:
    data_path = resources.files("env.tools.lexical").joinpath("domain_lexicon.json")
    data = json.loads(data_path.read_text(encoding="utf-8"))
    unigrams, bigrams = _frequencies() if include_word_frequencies else ({}, {})
    groups: dict[str, set[str]] = defaultdict(set)
    opposites = {tuple(sorted(pair)) for pair in data["opposites"]}
    sources = ["domain_lexicon:" + data["version"]]
    warnings = []

    if include_word_frequencies:
        sources.append("wordsegment:1.3.1")

    if include_wordnet:
        groups, wordnet_opposites, warning = _wordnet(directory)
        opposites.update(wordnet_opposites)

        if warning is not None:
            warnings.append(warning)
        else:
            sources.append("wordnet:3.0")

    for index, words in enumerate(data["synonyms"]):
        group = "curated:" + str(index)

        for word in words:
            groups.setdefault(word, set()).add(group)

    phrase_aliases = {
        tuple(phrase.split()): tuple(canonical.split())
        for phrase, canonical in data["phrases"].items()
    }
    abbreviations = {
        word: tuple(expansion.split())
        for word, expansion in data["abbreviations"].items()
    }
    words = set(data["terms"]) | set(groups) | set(abbreviations)
    words.update(token for phrase in phrase_aliases for token in phrase)
    words.update(token for phrase in phrase_aliases.values() for token in phrase)
    words.update(token for phrase in abbreviations.values() for token in phrase)
    words.update(token for pair in opposites for token in pair)

    for phrase in words:
        for word in phrase.split():
            if word.isalpha():
                floor = (
                    1_000_000.0
                    if word in data["terms"] or word in abbreviations
                    else 100.0
                )
                unigrams[word] = max(unigrams.get(word, 0.0), floor)

    frozen_groups = {}

    while groups:
        word, identifiers = groups.popitem()
        frozen_groups[word] = frozenset(identifiers)

    return LexiconData(
        unigrams=unigrams,
        bigrams=bigrams,
        synonym_groups=frozen_groups,
        phrase_aliases=phrase_aliases,
        abbreviations=abbreviations,
        opposites=frozenset(opposites),
        sources=tuple(sources),
        warnings=tuple(warnings),
    )


class CorpusLexicalResourceTool:
    """Read pinned frequency tables, local WordNet and explicit domain relations."""

    def __init__(
        self,
        corpus_directory: Path | None = None,
        include_wordnet: bool = True,
        include_word_frequencies: bool = True,
    ) -> None:
        self._directory = (
            corpus_directory or Path(__file__).resolve().parents[4] / "nltk_data"
        ).resolve()
        self._wordnet = include_wordnet
        self._frequencies = include_word_frequencies

    def load(self) -> LexiconData:
        return _load(self._directory, self._wordnet, self._frequencies)
