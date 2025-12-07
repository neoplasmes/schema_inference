from contextlib import contextmanager
from typing import cast

import pytest
from support import FakeIdentityCache

from app.ports.uow.workspace import WorkspaceUow
from app.use_cases.authorize_request import AuthorizeRequest
from core.entities import Principal

ALICE = Principal("alice", frozenset({"editor"}))
BOB = Principal("bob", frozenset({"editor"}))
ADMIN = Principal("root", frozenset({"admin"}))


class Repository:
    def __init__(self, owners):
        self.owners = owners
        self.lookups = 0

    def owner(self, kind, identifier):
        self.lookups += 1

        return self.owners.get((kind, identifier))


class Store:
    def __init__(self, owners):
        self.repository = Repository(owners)

    @contextmanager
    def read(self):
        yield self.repository


def build(owners=None):
    store = Store(owners or {("schema", "s1"): "alice", ("analysis", "a1"): "alice"})
    cache = FakeIdentityCache()

    return AuthorizeRequest(cast(WorkspaceUow, store), cache), store.repository, cache


@pytest.mark.parametrize(
    "uri",
    [
        "/api/v2/schemas/s1",
        "/api/v2/schemas/s1/revisions/s1/manifest",
        "/api/v2/schemas/s1?x=1",
        "/api/v2/analyses/a1",
        "/api/v2/analyses/a1/revisions/a1/manifest",
    ],
)
def test_owner_is_allowed_and_others_get_not_found(uri):
    use_case, _, _ = build()

    assert use_case.execute(ALICE, uri)
    assert not use_case.execute(BOB, uri)


def test_missing_resources_are_not_found_for_regular_users():
    use_case, _, _ = build()

    assert not use_case.execute(ALICE, "/api/v2/schemas/none")
    assert not use_case.execute(ALICE, "/api/v2/analyses/none")


def test_admin_bypasses_ownership_without_lookups():
    use_case, repository, _ = build()

    assert use_case.execute(ADMIN, "/api/v2/schemas/s1")
    assert use_case.execute(ADMIN, "/api/v2/schemas/none")
    assert repository.lookups == 0


@pytest.mark.parametrize(
    "uri", ["/api/v2/schemas", "/api/v2/analyses", "/api/v2/session", "/api/v2"]
)
def test_collection_and_other_routes_are_not_owner_scoped(uri):
    use_case, repository, _ = build()

    assert use_case.execute(BOB, uri)
    assert repository.lookups == 0


def test_owner_is_cached_after_the_first_lookup():
    use_case, repository, cache = build()

    use_case.execute(ALICE, "/api/v2/schemas/s1")
    use_case.execute(ALICE, "/api/v2/schemas/s1")

    assert repository.lookups == 1
    assert cache.owners == {("schema", "s1"): "alice"}


def test_missing_owner_is_not_cached():
    use_case, repository, cache = build()

    use_case.execute(ALICE, "/api/v2/schemas/none")
    use_case.execute(ALICE, "/api/v2/schemas/none")

    assert repository.lookups == 2
    assert cache.owners == {}
