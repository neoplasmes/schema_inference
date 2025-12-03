from contextlib import contextmanager
from typing import Iterator, cast
from unittest.mock import Mock

import pytest

from app.ports.repos.workspace import WorkspaceError, WorkspaceRepository
from app.ports.uow.workspace import WorkspaceUow
from app.use_cases.delete_analysis import DeleteAnalysis
from app.use_cases.delete_schema import DeleteSchema
from app.use_cases.read_workspace import ReadWorkspace
from app.use_cases.start_analysis import StartAnalysis
from core.entities import Principal

ALICE = Principal("alice", frozenset({"editor"}))
BOB = Principal("bob", frozenset({"editor"}))
ADMIN = Principal("root", frozenset({"admin"}))


class FakeRepository:
    def __init__(self):
        self.rows = {}
        self.owners = {}

    def owner(self, kind, identifier):
        return (
            self.owners.get((kind, identifier))
            if (kind, identifier) in self.rows
            else None
        )

    def resource(self, kind, identifier):
        return self.rows[(kind, identifier)]

    def put_resource(self, kind, value, owner=None):
        self.rows[(kind, value["id"])] = value
        self.owners.setdefault((kind, value["id"]), owner or "")

    def resources(self, kind, owner=None):
        return [
            value
            for (row_kind, identifier), value in self.rows.items()
            if row_kind == kind and owner in (None, self.owners[(kind, identifier)])
        ]

    def manifest(self, identifier, revision):
        return {"x": 1}

    def node(self, identifier, revision, node_id):
        return {"x": 1}

    def delete_resource(self, kind, identifier):
        del self.rows[(kind, identifier)]

    def replay(self, scope, key, digest):
        return None

    def remember(self, scope, key, digest, identifier):
        return None


class FakeStore:
    def __init__(self):
        self.repository = FakeRepository()

    @contextmanager
    def transaction(self) -> Iterator[WorkspaceRepository]:
        yield cast(WorkspaceRepository, self.repository)

    read = transaction


def uow(store: FakeStore) -> WorkspaceUow:
    return cast(WorkspaceUow, store)


def seeded() -> FakeStore:
    store = FakeStore()
    repository = store.repository
    repository.put_resource(
        "schema", {"id": "s1", "revision": "s3", "updated_at": "1"}, "alice"
    )
    repository.put_resource(
        "schema", {"id": "s2", "revision": "s1", "updated_at": "2"}, "bob"
    )
    repository.put_resource(
        "analysis", {"id": "a1", "status": "completed", "created_at": "1"}, "alice"
    )
    repository.put_resource(
        "analysis", {"id": "a2", "status": "processing", "created_at": "2"}, "alice"
    )

    return store


def test_lists_are_limited_to_the_owner_unless_admin():
    reads = ReadWorkspace(uow(seeded()))

    assert [item["id"] for item in reads.schemas(ALICE)] == ["s1"]
    assert [item["id"] for item in reads.schemas(BOB)] == ["s2"]
    assert [item["id"] for item in reads.schemas(ADMIN)] == ["s2", "s1"]
    assert [item["id"] for item in reads.analyses(ALICE)] == ["a2", "a1"]
    assert reads.analyses(BOB) == []


@pytest.mark.parametrize("kind,identifier", [("schema", "s2"), ("schema", "nope")])
def test_foreign_resources_look_like_missing_ones(kind, identifier):
    reads = ReadWorkspace(uow(seeded()))

    with pytest.raises(WorkspaceError) as error:
        reads.resource(kind, identifier, ALICE)

    assert error.value.code == "not_found"
    assert reads.resource("schema", "s2", ADMIN)["id"] == "s2"


def test_foreign_revisions_are_not_readable():
    store = seeded()
    reads = ReadWorkspace(uow(store))

    for read in (
        lambda: reads.manifest("s2", "s1", ALICE),
        lambda: reads.node("s2", "s1", "n", ALICE),
        lambda: reads.page("s2", "s1", "c", 10, None, ALICE),
        lambda: reads.receipt("s2", "m", ALICE),
        lambda: reads.analysis_manifest("a1", "r", BOB),
    ):
        with pytest.raises(WorkspaceError) as error:
            read()

        assert error.value.code == "not_found"

    assert reads.manifest("s1", "s1", ALICE) == {"x": 1}


def test_start_analysis_stores_owner():
    store = FakeStore()
    jobs = Mock()
    body = {"title": "t", "documents": [{"format": "json", "content": "{}"}]}

    resource = StartAnalysis(uow(store), jobs).execute(body, "key", ALICE)

    assert store.repository.owners[("analysis", resource["id"])] == "alice"
    jobs.submit.assert_called_once_with(resource["id"])


def test_delete_schema_requires_matching_if_match():
    store = seeded()
    delete = DeleteSchema(uow(store))

    with pytest.raises(WorkspaceError) as missing:
        delete.execute("s1", None, ALICE)

    with pytest.raises(WorkspaceError) as stale:
        delete.execute("s1", '"s1:s2"', ALICE)

    assert missing.value.code == "precondition_required"
    assert stale.value.code == "revision_conflict"
    assert ("schema", "s1") in store.repository.rows

    delete.execute("s1", '"s1:s3"', ALICE)

    assert ("schema", "s1") not in store.repository.rows


def test_delete_hides_foreign_resources_before_checking_preconditions():
    delete = DeleteSchema(uow(seeded()))

    with pytest.raises(WorkspaceError) as error:
        delete.execute("s2", None, ALICE)

    assert error.value.code == "not_found"


def test_delete_analysis_refuses_unfinished_work():
    store = seeded()
    delete = DeleteAnalysis(uow(store))

    with pytest.raises(WorkspaceError) as error:
        delete.execute("a2", ALICE)

    assert error.value.code == "not_ready"

    with pytest.raises(WorkspaceError) as foreign:
        delete.execute("a1", BOB)

    assert foreign.value.code == "not_found"

    delete.execute("a1", ALICE)

    assert ("analysis", "a1") not in store.repository.rows
