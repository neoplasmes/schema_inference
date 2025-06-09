from pathlib import Path

import pytest

from env.tools.lexical import CorpusLexicalResourceTool


@pytest.fixture(scope="module")
def data():
    directory = Path(__file__).resolve().parents[3] / "nltk_data"

    if not (directory / "corpora" / "wordnet.zip").is_file():
        pytest.skip(
            "The pinned WordNet archive must be installed for corpus integration tests"
        )

    return CorpusLexicalResourceTool(directory).load()


def test_historical_corpora_load_without_downloads(data):
    assert not data.warnings
    assert "wordnet:3.0" in data.sources
    assert "wordsegment:1.3.1" in data.sources
    assert len(data.unigrams) > 300_000
    assert len(data.bigrams) > 200_000


def test_wordnet_supplies_synonyms_outside_curated_domain(data):
    shared = data.synonym_groups["automobile"] & data.synonym_groups["car"]

    assert shared
    assert all(group.startswith("wordnet:") for group in shared)


def test_wordnet_supplies_multiword_senses(data):
    assert (
        data.synonym_groups["motor vehicle"] & data.synonym_groups["automotive vehicle"]
    )


def test_wordnet_keeps_distinct_senses_and_antonyms(data):
    assert len(data.synonym_groups["bank"]) > 1
    assert tuple(sorted(("hot", "cold"))) in data.opposites


def test_wordnet_irregular_inflections_share_base_senses(data):
    assert data.synonym_groups["mice"] & data.synonym_groups["mouse"]
