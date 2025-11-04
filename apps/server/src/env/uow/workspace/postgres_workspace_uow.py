import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from app.ports.repos.workspace import WorkspaceRepository
from env.repos.workspace import SqliteWorkspaceRepository


class SqliteWorkspaceUow:
    """Keep every write atomic while giving concurrent requests independent connections."""

    def __init__(self, path: Path) -> None:
        self._path = path
        path.parent.mkdir(parents=True, exist_ok=True)

        with self._connection() as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.executescript("""
                CREATE TABLE IF NOT EXISTS resources (
                    kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,
                    PRIMARY KEY (kind, id)
                );
                CREATE TABLE IF NOT EXISTS idempotency (
                    scope TEXT NOT NULL, key TEXT NOT NULL, digest TEXT NOT NULL,
                    resource_id TEXT NOT NULL, PRIMARY KEY (scope, key)
                );
                CREATE TABLE IF NOT EXISTS analysis_results (
                    id TEXT PRIMARY KEY, data TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS revisions (
                    schema_id TEXT NOT NULL, revision TEXT NOT NULL, data TEXT NOT NULL,
                    PRIMARY KEY (schema_id, revision)
                );
                CREATE TABLE IF NOT EXISTS nodes (
                    schema_id TEXT NOT NULL, revision TEXT NOT NULL, id TEXT NOT NULL,
                    data TEXT NOT NULL, PRIMARY KEY (schema_id, revision, id),
                    FOREIGN KEY (schema_id, revision) REFERENCES revisions
                );
                CREATE TABLE IF NOT EXISTS collections (
                    schema_id TEXT NOT NULL, revision TEXT NOT NULL, id TEXT NOT NULL,
                    PRIMARY KEY (schema_id, revision, id),
                    FOREIGN KEY (schema_id, revision) REFERENCES revisions
                );
                CREATE TABLE IF NOT EXISTS members (
                    schema_id TEXT NOT NULL, revision TEXT NOT NULL, collection_id TEXT NOT NULL,
                    position INTEGER NOT NULL, data TEXT NOT NULL,
                    PRIMARY KEY (schema_id, revision, collection_id, position),
                    FOREIGN KEY (schema_id, revision, collection_id) REFERENCES collections
                );
                CREATE TABLE IF NOT EXISTS changesets (
                    schema_id TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,
                    PRIMARY KEY (schema_id, id)
                );
            """)

    @contextmanager
    def _connection(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self._path, timeout=30, isolation_level=None)
        connection.execute("PRAGMA foreign_keys=ON")

        try:
            yield connection
        finally:
            connection.close()

    @contextmanager
    def read(self) -> Iterator[WorkspaceRepository]:
        with self._connection() as connection:
            connection.execute("BEGIN")

            try:
                yield SqliteWorkspaceRepository(connection)
            finally:
                connection.rollback()

    @contextmanager
    def transaction(self) -> Iterator[WorkspaceRepository]:
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")

            try:
                yield SqliteWorkspaceRepository(connection)
                connection.commit()
            except BaseException:
                connection.rollback()
                raise
