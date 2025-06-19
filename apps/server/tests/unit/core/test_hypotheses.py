from core.entities import XmlNode
from core.entities.matching import Correspondence
from core.processes.build_hypotheses import build_hypotheses
from core.processes.observe_documents import observe_documents


def _correspondence(left, right, score=0.95, conflicts=()):
    return Correspondence(
        f"{left}/{right}", left, right, "equivalent", score, (), (), conflicts, ()
    )


def test_complete_link_combines_mutually_compatible_aliases():
    corpus = observe_documents([XmlNode("a"), XmlNode("b"), XmlNode("c")])
    first, second, third = [profile.profile_id for profile in corpus.profiles]
    scored = [
        _correspondence(first, second),
        _correspondence(first, third),
        _correspondence(second, third),
    ]
    hypotheses = build_hypotheses(corpus, scored)

    assert hypotheses.groups == (tuple(sorted((first, second, third))),)
    assert not hypotheses.ambiguities


def test_a_b_c_chain_does_not_merge_conflicting_endpoints():
    corpus = observe_documents([XmlNode("a"), XmlNode("b"), XmlNode("c")])
    first, second, third = [profile.profile_id for profile in corpus.profiles]
    scored = [
        _correspondence(first, second, 0.97),
        _correspondence(second, third, 0.9),
        _correspondence(first, third, conflicts=("opposed_roles",)),
    ]
    hypotheses = build_hypotheses(corpus, scored)

    assert hypotheses.groups == (tuple(sorted((first, second))),)
    assert not any({first, third} <= set(group) for group in hypotheses.groups)


def test_symmetric_incompatible_partners_remain_explicit_alternatives():
    corpus = observe_documents([XmlNode("a"), XmlNode("b"), XmlNode("c")])
    first, second, third = [profile.profile_id for profile in corpus.profiles]
    scored = [_correspondence(first, second, 0.95), _correspondence(first, third, 0.94)]
    hypotheses = build_hypotheses(corpus, scored)

    assert hypotheses.groups == ()
    assert hypotheses.ambiguities == ((first, tuple(sorted((second, third)))),)
    assert hypotheses.diagnostics == ("ambiguous_profile_matches:1",)


def test_group_builder_defends_cooccurrence_even_for_supplied_high_scores():
    corpus = observe_documents(
        [XmlNode("root", children=[XmlNode("payer"), XmlNode("payee")])]
    )
    children = [
        profile.profile_id for profile in corpus.profiles if profile.parent_profile_id
    ]

    assert (
        build_hypotheses(corpus, [_correspondence(children[0], children[1])]).groups
        == ()
    )


def test_group_builder_defends_ancestor_descendant_roles():
    corpus = observe_documents([XmlNode("a", children=[XmlNode("b")])])
    first, second = [profile.profile_id for profile in corpus.profiles]

    assert build_hypotheses(corpus, [_correspondence(first, second)]).groups == ()


def test_group_suggestions_do_not_depend_on_correspondence_order():
    corpus = observe_documents([XmlNode("a"), XmlNode("b"), XmlNode("c")])
    first, second, third = [profile.profile_id for profile in corpus.profiles]
    scored = [_correspondence(first, second, 0.97), _correspondence(second, third, 0.9)]

    assert build_hypotheses(corpus, scored) == build_hypotheses(corpus, scored[::-1])
