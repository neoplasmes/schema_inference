import base64
import json

import pytest
from support import FakeIdentityCache

from app.use_cases.apply_identity_event import ApplyIdentityEvent
from core.entities import Identity


def build():
    cache = FakeIdentityCache()
    cache.put_token("t1", Identity("alice", frozenset(), 10**12), 300, 0)
    cache.put_token("t2", Identity("bob", frozenset(), 10**12), 300, 0)

    return ApplyIdentityEvent(cache), cache


def encode(payload) -> str:
    return base64.b64encode(json.dumps(payload).encode()).decode()


def test_oidc_session_added_links_both_identifiers_from_either_payload_shape():
    use_case, cache = build()
    use_case.execute(
        {
            "event_type": "oidc_session.added",
            "aggregateID": "o1",
            "userID": "actor",
            "event_payload": {"userID": "alice", "sessionID": "s1"},
        }
    )
    use_case.execute(
        {
            "event_type": "oidc_session.added",
            "aggregateID": "o2",
            "event_payload": encode({"userID": "bob", "sessionID": "s2"}),
        }
    )

    assert cache.oidc == {"o1": "alice", "o2": "bob"}
    assert cache.sessions == {"s1": "alice", "s2": "bob"}


def test_added_event_is_idempotent():
    use_case, cache = build()
    event = {
        "event_type": "oidc_session.added",
        "aggregateID": "o1",
        "event_payload": {"userID": "alice", "sessionID": "s1"},
    }
    use_case.execute(event)
    use_case.execute(event)

    assert cache.oidc == {"o1": "alice"}


@pytest.mark.parametrize(
    "kind",
    ["oidc_session.access_token.revoked", "oidc_session.refresh_token.revoked"],
)
def test_oidc_revocation_flushes_the_linked_subject(kind):
    use_case, cache = build()
    cache.link_oidc_session("o1", "alice")
    use_case.execute({"event_type": kind, "aggregateID": "o1"})

    assert "t1" not in cache.tokens
    assert "t2" in cache.tokens


def test_session_termination_flushes_the_linked_subject():
    use_case, cache = build()
    cache.link_session("s1", "bob")
    use_case.execute({"event_type": "session.terminated", "aggregateID": "s1"})

    assert "t2" not in cache.tokens
    assert "t1" in cache.tokens


def test_unknown_session_owner_flushes_everything():
    use_case, cache = build()
    use_case.execute({"event_type": "session.terminated", "aggregateID": "missing"})

    assert cache.tokens == {}


@pytest.mark.parametrize(
    "kind",
    [
        "user.deactivated",
        "user.locked",
        "user.removed",
        "user.token.removed",
        "user.human.refresh.token.removed",
    ],
)
def test_user_events_flush_that_user_only(kind):
    use_case, cache = build()
    use_case.execute({"event_type": kind, "aggregateID": "alice"})
    use_case.execute({"event_type": kind, "aggregateID": "alice"})

    assert "t1" not in cache.tokens
    assert "t2" in cache.tokens


@pytest.mark.parametrize(
    "kind",
    [
        "user.grant.changed",
        "user.grant.removed",
        "user.grant.deactivated",
        "user.grant.cascade.changed",
        "user.grant.cascade.removed",
    ],
)
def test_grant_events_flush_the_payload_user_or_everyone(kind):
    use_case, cache = build()
    use_case.execute(
        {
            "event_type": kind,
            "aggregateID": "grant",
            "event_payload": encode({"userId": "alice"}),
        }
    )

    assert "t1" not in cache.tokens
    assert "t2" in cache.tokens

    use_case.execute({"event_type": kind, "aggregateID": "grant"})

    assert cache.tokens == {}


@pytest.mark.parametrize("kind", ["project.role.removed", "project.role.changed"])
def test_role_events_flush_everything(kind):
    use_case, cache = build()
    use_case.execute({"event_type": kind, "aggregateID": "p"})

    assert cache.tokens == {}


def test_unknown_events_are_ignored():
    use_case, cache = build()
    use_case.execute({"event_type": "something.else", "aggregateID": "alice"})
    use_case.execute({})

    assert cache.flushed_all == 0
    assert set(cache.tokens) == {"t1", "t2"}


def test_malformed_grant_payload_flushes_everything():
    use_case, cache = build()
    use_case.execute({"event_type": "user.grant.changed", "event_payload": "!!"})

    assert cache.flushed_all == 1
