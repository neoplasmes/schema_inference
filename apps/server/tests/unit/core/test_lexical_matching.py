import pytest

from core.entities.lexical import LexiconData, Segmentation
from core.processes.compare_names import character_ngrams, compare_names


@pytest.fixture
def lexicon():
    groups = [
        ("customer", "client"),
        ("billing", "invoice"),
        ("shipping", "delivery"),
        ("address", "location"),
        ("quantity", "count"),
        ("car", "automobile"),
    ]
    words = {
        "given",
        "first",
        "name",
        "family",
        "last",
        "surname",
        "qty",
        "payer",
        "payee",
        "source",
        "destination",
        "id",
        "code",
        "billing",
        "shipping",
        "person",
        "account",
        "bank",
        "river",
        "balance",
        "item",
        "items",
    }
    words.update(word for group in groups for word in group)

    return LexiconData(
        unigrams={word: 1000 for word in words},
        synonym_groups={
            word: frozenset({"curated:" + str(index)})
            for index, group in enumerate(groups)
            for word in group
        },
        phrase_aliases={
            ("given", "name"): ("givenname",),
            ("first", "name"): ("givenname",),
            ("family", "name"): ("surname",),
            ("last", "name"): ("surname",),
        },
        abbreviations={"qty": ("quantity",)},
        opposites=frozenset({("payer", "payee"), ("billing", "shipping")}),
    )


def test_all_compound_words_can_be_replaced_with_synonyms(lexicon):
    match = compare_names("customerbillingaddress", "clientinvoicelocation", lexicon)

    assert match.score > 0.9
    assert sum("curated_synonym" in evidence for evidence in match.evidence) == 3
    assert not match.conflicts


def test_synonyms_do_not_need_character_overlap(lexicon):
    assert not character_ngrams("car") & character_ngrams("automobile")
    assert compare_names("car", "automobile", lexicon).score > 0.9


@pytest.mark.parametrize(
    "left,right", [("givenname", "firstname"), ("familyname", "lastname")]
)
def test_phrase_meaning_is_compared_as_one_unit(lexicon, left, right):
    match = compare_names(left, right, lexicon)

    assert match.score > 0.9
    assert "phrase_or_abbreviation_expansion" in match.evidence


def test_abbreviation_is_expanded(lexicon):
    assert compare_names("qty", "quantity", lexicon).score > 0.9


def test_adjacent_transposition_is_recoverable(lexicon):
    assert compare_names("customeraddress", "customreaddress", lexicon).score > 0.8


@pytest.mark.parametrize(
    "left,right",
    [
        ("billingaddress", "shippingaddress"),
        ("invoicelocation", "deliverylocation"),
        ("payer", "payee"),
    ],
)
def test_role_opposition_vetoes_typo_and_common_children_evidence(lexicon, left, right):
    match = compare_names(left, right, lexicon)

    assert match.score <= 0.25
    assert match.conflicts


def test_unmatched_tokens_reduce_coverage(lexicon):
    full = compare_names("customeraddress", "clientlocation", lexicon)
    partial = compare_names("customeraddress", "client", lexicon)

    assert partial.score < full.score - 0.25
    assert "unmatched_tokens" in partial.evidence


def test_one_source_token_cannot_cover_repeated_target_tokens(lexicon):
    match = compare_names("customer", "client_client", lexicon)

    assert match.score < 0.6


def test_unknown_short_codes_are_not_merged_by_edit_distance(lexicon):
    assert compare_names("qa", "qb", lexicon).score == 0


def test_character_overlap_does_not_invent_semantics(lexicon):
    assert compare_names("river", "account", lexicon).score < 0.4


def test_token_comparison_is_symmetric(lexicon):
    forward = compare_names("customerbillingaddress", "clientinvoicelocation", lexicon)
    backward = compare_names("clientinvoicelocation", "customerbillingaddress", lexicon)

    assert forward.score == backward.score
    assert forward.conflicts == backward.conflicts


def test_simple_plural_is_an_inflection(lexicon):
    assert compare_names("items", "item", lexicon).score > 0.9


def test_wordnet_shared_sense_is_weaker_than_curated_relation():
    data = LexiconData(
        unigrams={"automobile": 100, "car": 100},
        synonym_groups={
            "automobile": frozenset({"wordnet:car.n.01"}),
            "car": frozenset({"wordnet:car.n.01", "wordnet:car.n.02"}),
        },
    )
    match = compare_names("car", "automobile", data)

    assert 0.8 < match.score < 0.9
    assert any("shared_wordnet_sense" in evidence for evidence in match.evidence)


def test_empty_names_do_not_imply_match(lexicon):
    assert compare_names("", "", lexicon).score == 0


def test_phrase_canonicalization_preserves_partial_token_evidence():
    data = LexiconData(
        unigrams={"unit": 100, "units": 100, "price": 100},
        phrase_aliases={("unit", "price"): ("unitprice",)},
    )
    match = compare_names("unitprice", "price", data)

    assert match.score == 0.5
    assert match.left.tokens == ("unit", "price")
    assert not match.left.corrections
    assert "unmatched_tokens" in match.evidence


def test_improbable_segmentation_cannot_manufacture_a_strong_match(lexicon):
    alternatives = (
        Segmentation("unrelated", "unrelated", ("unrelated",), 0),
        Segmentation("unrelated", "unrelated", ("customer",), -100),
    )
    target = (Segmentation("client", "client", ("client",), 0),)

    assert compare_names(alternatives, target, lexicon).score < 0.5


def test_plausible_alternative_remains_available_with_evidence(lexicon):
    alternatives = (
        Segmentation("source", "source", ("unrelated",), 0),
        Segmentation("source", "source", ("customer",), -1),
    )
    target = (Segmentation("client", "client", ("client",), 0),)
    match = compare_names(alternatives, target, lexicon)

    assert 0.85 < match.score < 0.94
    assert "alternative_segmentation" in match.evidence


@pytest.mark.parametrize(
    "first,second", [("addresses", "address"), ("boxes", "box"), ("branches", "branch")]
)
def test_regular_es_plurals_use_dictionary_base_forms(first, second):
    data = LexiconData(unigrams={first: 100, second: 100})

    assert compare_names(first, second, data).score > 0.9


def test_extreme_names_do_not_enter_quadratic_edit_distance(lexicon):
    match = compare_names("a" * 10_000, "b" * 10_000, lexicon)

    assert match.score == 0
    assert match.evidence == ("identifier_analysis_limit",)


def test_external_segmentation_cannot_create_unbounded_assignment(lexicon):
    first = (Segmentation("a", "a", ("a",) * 5000, 0),)
    second = (Segmentation("b", "b", ("b",) * 5000, 0),)
    match = compare_names(first, second, lexicon)

    assert match.score == 0
    assert match.evidence == ("identifier_analysis_limit",)
