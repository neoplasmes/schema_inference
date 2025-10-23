import json
import sqlite3
from typing import Any

from app.ports.repos.workspace import WorkspaceError
from core.entities.schema_draft import SchemaGraph


def encode(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


class SqliteWorkspaceRepository:
    """Store entity payloads separately so node and page reads remain bounded."""

    def __init__(self, connection: sqlite3.Connection) -> None:
        self._db = connection

    def _one(self, sql: str, parameters: tuple) -> dict[str, Any]:
        row = self._db.execute(sql, parameters).fetchone()

        if row is None:
            raise WorkspaceError("not_found", "Resource does not exist.")

        return json.loads(row[0])

    def resource(self, kind: str, identifier: str) -> dict[str, Any]:
        return self._one(
            "SELECT data FROM resources WHERE kind=? AND id=?", (kind, identifier)
        )

    def put_resource(self, kind: str, value: dict[str, Any]) -> None:
        self._db.execute(
            "INSERT INTO resources VALUES (?, ?, ?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data",
            (kind, value["id"], encode(value)),
        )

    def resources(self, kind: str) -> list[dict[str, Any]]:
        return [
            json.loads(row[0])
            for row in self._db.execute(
                "SELECT data FROM resources WHERE kind=? ORDER BY id", (kind,)
            )
        ]

    def replay(self, scope: str, key: str, digest: str) -> str | None:
        row = self._db.execute(
            "SELECT digest,resource_id FROM idempotency WHERE scope=? AND key=?",
            (scope, key),
        ).fetchone()

        if row is not None and row[0] != digest:
            raise WorkspaceError(
                "idempotency_conflict",
                "This idempotency key was used for another request.",
            )

        return row[1] if row else None

    def remember(self, scope: str, key: str, digest: str, identifier: str) -> None:
        self._db.execute(
            "INSERT INTO idempotency VALUES (?, ?, ?, ?)",
            (scope, key, digest, identifier),
        )

    def put_analysis_result(self, identifier: str, result: dict[str, Any]) -> None:
        self._db.execute(
            "INSERT INTO analysis_results VALUES (?, ?)", (identifier, encode(result))
        )

    def analysis_result(self, identifier: str) -> dict[str, Any]:
        return self._one("SELECT data FROM analysis_results WHERE id=?", (identifier,))

    def save_revision(self, manifest: dict[str, Any], graph: SchemaGraph) -> None:
        identity = (manifest["snapshot"]["id"], manifest["snapshot"]["revision"])
        self._db.execute(
            "INSERT INTO revisions VALUES (?, ?, ?)", (*identity, encode(manifest))
        )
        self._db.executemany(
            "INSERT INTO nodes VALUES (?, ?, ?, ?)",
            [(*identity, key, encode(value)) for key, value in graph.nodes.items()],
        )
        self._db.executemany(
            "INSERT INTO collections VALUES (?, ?, ?)",
            [(*identity, key) for key in graph.collections],
        )
        self._db.executemany(
            "INSERT INTO members VALUES (?, ?, ?, ?, ?)",
            [
                (*identity, key, position, encode(value))
                for key, members in graph.collections.items()
                for position, value in enumerate(members)
            ],
        )

    def manifest(self, identifier: str, revision: str) -> dict[str, Any]:
        return self._one(
            "SELECT data FROM revisions WHERE schema_id=? AND revision=?",
            (identifier, revision),
        )

    def node(self, identifier: str, revision: str, node_id: str) -> dict[str, Any]:
        return self._one(
            "SELECT data FROM nodes WHERE schema_id=? AND revision=? AND id=?",
            (identifier, revision, node_id),
        )

    def page(
        self,
        identifier: str,
        revision: str,
        collection_id: str,
        offset: int,
        limit: int,
    ) -> tuple[list[dict[str, Any]], int]:
        identity = (identifier, revision, collection_id)

        if (
            self._db.execute(
                "SELECT 1 FROM collections WHERE schema_id=? AND revision=? AND id=?",
                identity,
            ).fetchone()
            is None
        ):
            raise WorkspaceError("not_found", "Collection does not exist.")

        total = self._db.execute(
            "SELECT count(*) FROM members WHERE schema_id=? AND revision=? AND collection_id=?",
            identity,
        ).fetchone()[0]
        rows = self._db.execute(
            "SELECT data FROM members WHERE schema_id=? AND revision=? AND collection_id=? ORDER BY position LIMIT ? OFFSET ?",
            (*identity, limit, offset),
        )

        return [json.loads(row[0]) for row in rows], total

    def graph(self, identifier: str, revision: str) -> SchemaGraph:
        manifest = self.manifest(identifier, revision)
        identity = (identifier, revision)
        nodes = {
            row[0]: json.loads(row[1])
            for row in self._db.execute(
                "SELECT id,data FROM nodes WHERE schema_id=? AND revision=?", identity
            )
        }
        collections = {
            row[0]: []
            for row in self._db.execute(
                "SELECT id FROM collections WHERE schema_id=? AND revision=?", identity
            )
        }

        for collection, data in self._db.execute(
            "SELECT collection_id,data FROM members WHERE schema_id=? AND revision=? ORDER BY position",
            identity,
        ):
            collections[collection].append(json.loads(data))

        return SchemaGraph(
            manifest["rootNodeId"], manifest["profile"], nodes, collections
        )

    def receipt(self, identifier: str, mutation_id: str) -> dict[str, Any]:
        return self._one(
            "SELECT data FROM changesets WHERE schema_id=? AND id=?",
            (identifier, mutation_id),
        )

    def put_receipt(self, identifier: str, receipt: dict[str, Any]) -> None:
        self._db.execute(
            "INSERT INTO changesets VALUES (?, ?, ?)",
            (identifier, receipt["id"], encode(receipt)),
        )
