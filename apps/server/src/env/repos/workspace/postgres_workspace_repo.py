from typing import Any, LiteralString

from psycopg import Connection
from psycopg.types.json import Jsonb

from app.ports.repos.workspace import WorkspaceError
from core.entities.schema_draft import SchemaGraph


class PostgresWorkspaceRepository:
    """Store entity payloads separately so node and page reads remain bounded."""

    def __init__(self, connection: Connection, *, writable: bool = False) -> None:
        self._db = connection
        self._writable = writable

    def _one(self, sql: LiteralString, parameters: tuple) -> dict[str, Any]:
        row = self._db.execute(sql, parameters).fetchone()

        if row is None:
            raise WorkspaceError("not_found", "Resource does not exist.")

        return row[0]

    def resource(self, kind: str, identifier: str) -> dict[str, Any]:
        """Lock mutable rows before a write transaction checks or changes their state."""
        query = "SELECT data FROM resources WHERE kind=%s AND id=%s"

        if self._writable:
            query += " FOR UPDATE"

        return self._one(query, (kind, identifier))

    def put_resource(self, kind: str, value: dict[str, Any]) -> None:
        self._db.execute(
            "INSERT INTO resources (kind, id, data) VALUES (%s, %s, %s) "
            "ON CONFLICT(kind, id) DO UPDATE SET data=excluded.data",
            (kind, value["id"], Jsonb(value)),
        )

    def resources(self, kind: str) -> list[dict[str, Any]]:
        return [
            row[0]
            for row in self._db.execute(
                "SELECT data FROM resources WHERE kind=%s ORDER BY id", (kind,)
            )
        ]

    def replay(self, scope: str, key: str, digest: str) -> str | None:
        """Serialize retries before checking keys, including keys not yet inserted."""
        if self._writable:
            self._db.execute(
                "SELECT pg_advisory_xact_lock(hashtext(%s), hashtext(%s))",
                (scope, key),
            )

        row = self._db.execute(
            "SELECT digest, resource_id FROM idempotency WHERE scope=%s AND key=%s",
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
            "INSERT INTO idempotency (scope, key, digest, resource_id) VALUES (%s, %s, %s, %s)",
            (scope, key, digest, identifier),
        )

    def put_analysis_result(self, identifier: str, result: dict[str, Any]) -> None:
        self._db.execute(
            "INSERT INTO analysis_results (id, data) VALUES (%s, %s)",
            (identifier, Jsonb(result)),
        )

    def analysis_result(self, identifier: str) -> dict[str, Any]:
        return self._one("SELECT data FROM analysis_results WHERE id=%s", (identifier,))

    def save_revision(self, manifest: dict[str, Any], graph: SchemaGraph) -> None:
        identity = (manifest["snapshot"]["id"], manifest["snapshot"]["revision"])
        self._db.execute(
            "INSERT INTO revisions (schema_id, revision, data) VALUES (%s, %s, %s)",
            (*identity, Jsonb(manifest)),
        )

        with self._db.cursor() as cursor:
            cursor.executemany(
                "INSERT INTO nodes (schema_id, revision, id, data) VALUES (%s, %s, %s, %s)",
                [(*identity, key, Jsonb(value)) for key, value in graph.nodes.items()],
            )
            cursor.executemany(
                "INSERT INTO collections (schema_id, revision, id) VALUES (%s, %s, %s)",
                [(*identity, key) for key in graph.collections],
            )
            cursor.executemany(
                "INSERT INTO members (schema_id, revision, collection_id, position, data) "
                "VALUES (%s, %s, %s, %s, %s)",
                [
                    (*identity, key, position, Jsonb(value))
                    for key, members in graph.collections.items()
                    for position, value in enumerate(members)
                ],
            )

    def manifest(self, identifier: str, revision: str) -> dict[str, Any]:
        return self._one(
            "SELECT data FROM revisions WHERE schema_id=%s AND revision=%s",
            (identifier, revision),
        )

    def node(self, identifier: str, revision: str, node_id: str) -> dict[str, Any]:
        return self._one(
            "SELECT data FROM nodes WHERE schema_id=%s AND revision=%s AND id=%s",
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
                "SELECT 1 FROM collections WHERE schema_id=%s AND revision=%s AND id=%s",
                identity,
            ).fetchone()
            is None
        ):
            raise WorkspaceError("not_found", "Collection does not exist.")

        count = self._db.execute(
            "SELECT count(*) FROM members "
            "WHERE schema_id=%s AND revision=%s AND collection_id=%s",
            identity,
        ).fetchone()
        assert count is not None
        rows = self._db.execute(
            "SELECT data FROM members "
            "WHERE schema_id=%s AND revision=%s AND collection_id=%s "
            "ORDER BY position LIMIT %s OFFSET %s",
            (*identity, limit, offset),
        )

        return [row[0] for row in rows], count[0]

    def graph(self, identifier: str, revision: str) -> SchemaGraph:
        manifest = self.manifest(identifier, revision)
        identity = (identifier, revision)
        nodes = {
            row[0]: row[1]
            for row in self._db.execute(
                "SELECT id, data FROM nodes WHERE schema_id=%s AND revision=%s",
                identity,
            )
        }
        collections: dict[str, list[dict[str, Any]]] = {
            row[0]: []
            for row in self._db.execute(
                "SELECT id FROM collections WHERE schema_id=%s AND revision=%s",
                identity,
            )
        }

        for collection, data in self._db.execute(
            "SELECT collection_id, data FROM members "
            "WHERE schema_id=%s AND revision=%s ORDER BY position",
            identity,
        ):
            collections[collection].append(data)

        return SchemaGraph(
            manifest["rootNodeId"], manifest["profile"], nodes, collections
        )

    def receipt(self, identifier: str, mutation_id: str) -> dict[str, Any]:
        return self._one(
            "SELECT data FROM changesets WHERE schema_id=%s AND id=%s",
            (identifier, mutation_id),
        )

    def put_receipt(self, identifier: str, receipt: dict[str, Any]) -> None:
        self._db.execute(
            "INSERT INTO changesets (schema_id, id, data) VALUES (%s, %s, %s)",
            (identifier, receipt["id"], Jsonb(receipt)),
        )
