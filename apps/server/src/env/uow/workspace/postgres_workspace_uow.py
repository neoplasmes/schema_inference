from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from psycopg import Connection, IsolationLevel, connect

from app.ports.repos.workspace import WorkspaceRepository
from env.repos.workspace import PostgresWorkspaceRepository


class PostgresWorkspaceUow:
    """Open one connection per transaction and release it back to PgBouncer."""

    def __init__(self, database_url: str) -> None:
        self._database_url = database_url

    def initialize(self) -> None:
        """Apply the owned database schema once, serializing concurrent startups."""
        with self._connection() as connection, connection.transaction():
            connection.execute(
                "SELECT pg_advisory_xact_lock(hashtext('workspace migrations'), 0)"
            )
            connection.execute(
                "CREATE TABLE IF NOT EXISTS workspace_migrations "
                "(version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())"
            )
            versions = [
                row[0]
                for row in connection.execute(
                    "SELECT version FROM workspace_migrations ORDER BY version"
                )
            ]

            migrations = self._migrations()

            if versions != [number for number, _ in migrations][: len(versions)]:
                raise RuntimeError(
                    f"Unsupported workspace database migrations: {versions}"
                )

            for number, path in migrations[len(versions) :]:
                connection.execute(path.read_bytes())
                connection.execute(
                    "INSERT INTO workspace_migrations (version) VALUES (%s)",
                    (number,),
                )

    @staticmethod
    def _migrations() -> list[tuple[int, Path]]:
        """List numbered migration files next to this module in version order."""
        found = [
            (int(path.name.split("_", 1)[0]), path)
            for path in Path(__file__).parent.glob("[0-9][0-9][0-9]_workspace.sql")
        ]

        return sorted(found)

    @contextmanager
    def _connection(self) -> Iterator[Connection]:
        connection = connect(
            self._database_url,
            connect_timeout=5,
            prepare_threshold=None,
        )

        try:
            yield connection
        finally:
            connection.close()

    @contextmanager
    def read(self) -> Iterator[WorkspaceRepository]:
        """Read related payloads from one stable snapshot without taking write locks."""
        with self._connection() as connection:
            connection.isolation_level = IsolationLevel.REPEATABLE_READ
            connection.read_only = True

            with connection.transaction():
                yield PostgresWorkspaceRepository(connection)

    @contextmanager
    def transaction(self) -> Iterator[WorkspaceRepository]:
        """Commit an atomic batch after locking its mutable resources and retry keys."""
        with self._connection() as connection:
            connection.isolation_level = IsolationLevel.READ_COMMITTED

            with connection.transaction():
                yield PostgresWorkspaceRepository(connection, writable=True)
