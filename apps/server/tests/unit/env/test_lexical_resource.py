from env.tools.lexical import CorpusLexicalResourceTool


def test_curated_lexicon_loads_without_external_corpora(tmp_path):
    """Load domain words and relationships without optional corpus files."""
    resource = CorpusLexicalResourceTool(
        tmp_path, include_wordnet=False, include_word_frequencies=False
    )
    data = resource.load()

    assert "customer" in data.unigrams
    assert data.synonym_groups["customer"] & data.synonym_groups["client"]
    assert data.abbreviations["qty"] == ("quantity",)
    assert data.phrase_aliases[("first", "name")] == ("givenname",)
    assert tuple(sorted(("billing", "shipping"))) in data.opposites
    assert data.sources == ("domain_lexicon:1.0.0",)


def test_missing_wordnet_is_an_explicit_capability_gap(tmp_path):
    """Report missing WordNet data while keeping the domain lexicon available."""
    data = CorpusLexicalResourceTool(tmp_path, include_word_frequencies=False).load()

    assert "wordnet_unavailable" in data.warnings
    assert "wordnet:3.0" not in data.sources
    assert data.unigrams


def test_archive_with_wrong_hash_is_not_trusted(tmp_path):
    """Exclude a WordNet archive whose checksum does not match the pinned corpus."""
    corpus = tmp_path / "corpora"
    corpus.mkdir()
    (corpus / "wordnet.zip").write_bytes(b"unrelated corpus content")

    data = CorpusLexicalResourceTool(tmp_path, include_word_frequencies=False).load()

    assert data.warnings == ("wordnet_checksum_mismatch",)
    assert "wordnet:3.0" not in data.sources
