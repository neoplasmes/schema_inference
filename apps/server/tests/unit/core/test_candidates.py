from collections import Counter

from core.entities import XmlNode
from core.entities.lexical import LexiconData
from core.entities.matching import MatchingConfig
from core.processes.observe_documents import observe_documents
from core.processes.prepare_candidates import prepare_candidates


def test_candidates_find_synonyms_without_equal_parent_names():
    corpus = observe_documents(
        [
            XmlNode("customers", children=[XmlNode("billingaddress")]),
            XmlNode("clients", children=[XmlNode("invoicelocation")]),
        ]
    )
    lexicon = LexiconData(
        unigrams={
            word: 100
            for word in (
                "customer",
                "customers",
                "client",
                "clients",
                "billing",
                "invoice",
                "address",
                "location",
            )
        },
        synonym_groups={
            "billing": frozenset({"curated:payment"}),
            "invoice": frozenset({"curated:payment"}),
            "address": frozenset({"curated:place"}),
            "location": frozenset({"curated:place"}),
        },
    )
    profiles = {profile.profile_id: profile for profile in corpus.profiles}
    candidates = prepare_candidates(corpus, lexicon)
    matched = [
        pair
        for pair in candidates.pairs
        if {profiles[pair.left].name.local_name, profiles[pair.right].name.local_name}
        == {"billingaddress", "invoicelocation"}
    ]

    assert len(matched) == 1
    assert matched[0].name_match.score > 0.8


def test_shape_index_retains_candidates_with_no_shared_characters():
    corpus = observe_documents(
        [
            XmlNode("abc", children=[XmlNode("def")]),
            XmlNode("xyz", children=[XmlNode("uvw")]),
        ]
    )
    candidates = prepare_candidates(corpus, LexiconData(unigrams={}))
    roots = {
        profile.profile_id
        for profile in corpus.profiles
        if profile.parent_profile_id is None
    }

    assert any({pair.left, pair.right} == roots for pair in candidates.pairs)


def test_candidate_budgets_are_explicit_and_degree_is_bounded():
    corpus = observe_documents(
        [XmlNode(f"document{index:03}", "value") for index in range(80)]
    )
    config = MatchingConfig(
        max_pairs=12, max_candidates_per_profile=2, max_bucket_size=8, max_index_terms=4
    )
    candidates = prepare_candidates(corpus, LexiconData(unigrams={}), config=config)
    degrees = Counter(
        profile for pair in candidates.pairs for profile in (pair.left, pair.right)
    )

    assert len(candidates.pairs) <= 12
    assert max(degrees.values()) <= 2
    assert candidates.diagnostics
    assert any("budget_reached" in message for message in candidates.diagnostics)


def test_candidate_identity_and_order_are_permutation_stable():
    roots = [XmlNode("customer"), XmlNode("client"), XmlNode("buyer")]
    lexicon = LexiconData(unigrams={"customer": 100, "client": 100, "buyer": 100})

    assert prepare_candidates(observe_documents(roots), lexicon) == prepare_candidates(
        observe_documents(roots[::-1]), lexicon
    )
