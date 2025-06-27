import pytest

from core.entities.lexical import LexiconData, SegmentationConfig
from core.processes.segment_identifier import segment_identifier


@pytest.fixture
def lexicon():
    return LexiconData(
        unigrams={
            "customer": 800,
            "billing": 700,
            "address": 900,
            "client": 900,
            "invoice": 800,
            "location": 800,
            "shipping": 600,
            "delivery": 700,
            "the": 10000,
            "therapist": 10,
            "rapist": 10,
            "therapists": 5,
            "expert": 300,
            "sex": 800,
            "change": 800,
            "exchange": 500,
            "rate": 600,
            "rates": 600,
            "xml": 100,
            "http": 100,
            "id": 100,
            "phone": 100,
            "number": 100,
            "account": 100,
            "姓名": 100,
        },
        bigrams={
            ("customer", "billing"): 650,
            ("billing", "address"): 600,
            ("exchange", "rates"): 490,
        },
    )


def test_lowercase_compound_boundaries(lexicon):
    options = segment_identifier("customerbillingaddress", lexicon)

    assert options[0].tokens == ("customer", "billing", "address")
    assert options[0].original == "customerbillingaddress"
    assert not options[0].unknown
    assert any(option.tokens == ("customerbillingaddress",) for option in options)


@pytest.mark.parametrize(
    "name",
    [
        "customerBillingAddress",
        "CustomerBillingAddress",
        "customer_billing_address",
        "customer-billing-address",
        "{urn:customer}customerBillingAddress",
    ],
)
def test_explicit_boundaries_and_qname(lexicon, name):
    assert segment_identifier(name, lexicon)[0].tokens == (
        "customer",
        "billing",
        "address",
    )


@pytest.mark.parametrize(
    "misspelled",
    [
        "customerbillingaddres",
        "customerbillnigaddress",
        "customrebillingaddress",
        "customerbillingadddress",
        "customerbillingaddross",
    ],
)
def test_typo_inside_compound_retains_recoverable_path(lexicon, misspelled):
    options = segment_identifier(misspelled, lexicon)
    corrected = [
        option
        for option in options
        if option.tokens == ("customer", "billing", "address")
    ]

    assert corrected
    assert corrected[0].corrections


def test_alternative_boundaries_are_not_discarded(lexicon):
    options = segment_identifier("therapist", lexicon)
    tokens = {option.tokens for option in options}

    assert ("therapist",) in tokens
    assert ("the", "rapist") in tokens


def test_bigram_frequency_selects_plausible_sequence(lexicon):
    assert segment_identifier("exchangerates", lexicon)[0].tokens == (
        "exchange",
        "rates",
    )


def test_unknown_identifier_preserves_source(lexicon):
    options = segment_identifier("qxzvblorp", lexicon)

    assert options[0].tokens == ("qxzvblorp",)
    assert options[0].unknown == ("qxzvblorp",)


def test_unknown_fragment_does_not_hide_known_suffix(lexicon):
    options = segment_identifier("qxzvaddress", lexicon)

    assert any(option.tokens == ("qxzv", "address") for option in options)
    assert any("qxzv" in option.unknown for option in options)


def test_acronym_and_digit_boundaries_are_kept(lexicon):
    assert segment_identifier("HTTPPhone2Number", lexicon)[0].tokens == (
        "http",
        "phone",
        "2",
        "number",
    )


def test_unicode_survives_without_ascii_transliteration(lexicon):
    assert segment_identifier("姓名", lexicon)[0].tokens == ("姓名",)
    assert segment_identifier("адрес", lexicon)[0].unknown == ("адрес",)


def test_limits_preserve_long_input_without_exhaustive_search(lexicon):
    name = "customer" * 1000
    result = segment_identifier(name, lexicon)

    assert len(result) == 1
    assert result[0].original == name
    assert result[0].tokens == (name,)


def test_repeated_analysis_reuses_immutable_result(lexicon):
    first = segment_identifier("customerbillingaddress", lexicon)
    second = segment_identifier("customerbillingaddress", lexicon)

    assert first is second

    with pytest.raises(TypeError):
        lexicon.unigrams["surprise"] = 10


def test_empty_name_is_explicit(lexicon):
    assert segment_identifier("", lexicon)[0].tokens == ()


def test_beam_cannot_be_smaller_than_result_set():
    with pytest.raises(ValueError):
        SegmentationConfig(top_k=10, beam_width=5)


@pytest.mark.parametrize(
    "configuration",
    [
        {"top_k": 1.5},
        {"beam_width": True},
        {"max_identifier_length": float("inf")},
        {"max_tokens": float("nan")},
        {"max_tokens": True},
        {"max_word_length": 0},
        {"max_typo_candidates": -1},
        {"max_typo_visits": 1.0},
    ],
)
def test_invalid_limits_fail_before_analysis(configuration):
    with pytest.raises(ValueError, match="positive integers"):
        SegmentationConfig(**configuration)


@pytest.mark.parametrize(
    "configuration",
    [
        {"typo_penalty": float("inf")},
        {"typo_penalty": -1},
        {"typo_penalty": True},
        {"unknown_penalty": float("nan")},
        {"unknown_penalty": float("-inf")},
        {"unknown_penalty": False},
    ],
)
def test_invalid_penalties_cannot_reach_json_scores(configuration):
    with pytest.raises(ValueError, match="finite nonnegative"):
        SegmentationConfig(**configuration)
