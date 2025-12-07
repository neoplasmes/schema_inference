import os
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import quote
from uuid import uuid4

import psycopg
from psycopg import sql
from testcontainers.compose import DockerCompose

ROOT = Path(__file__).resolve().parents[4]
LOCAL_ENV = ROOT / "env" / "local" / ".env"


def postgres_password() -> str:
    """Read the database password from the environment or the generated Compose file.

    The value comes from ``POSTGRES_PASSWORD`` or, failing that, from
    ``env/local/.env`` created by ``moon run env:secrets``; there is no default.
    """
    value = os.environ.get("POSTGRES_PASSWORD")

    if value:
        return value

    if LOCAL_ENV.exists():
        for line in LOCAL_ENV.read_text().splitlines():
            name, _, raw = line.partition("=")

            if name.strip() == "POSTGRES_PASSWORD" and raw.strip():
                return raw.strip()

    raise RuntimeError("POSTGRES_PASSWORD is not set; run `moon run env:secrets`")


class DatabaseStack:
    """Own an isolated PostgreSQL and PgBouncer Compose project for tests."""

    def __init__(
        self, *, api: bool = False, api_port: int | None = None, client: bool = False
    ) -> None:
        self.name = f"workspace-test-{uuid4().hex[:12]}"
        self.url = ""
        self.api_url = ""
        self.api = api or client
        self.api_port = api_port
        self.client = client
        self.compose: DockerCompose | None = None

    @contextmanager
    def running(self) -> Iterator["DatabaseStack"]:
        """Start healthy containers and remove this project's volumes on exit."""
        with TemporaryDirectory(prefix=self.name) as directory:
            override = Path(directory) / "compose.yaml"
            overrides = (
                f"name: {self.name}\n"
                "services:\n"
                "  pgbouncer:\n"
                "    ports: !override ['127.0.0.1::6432']\n"
            )
            files = [str(ROOT / "env" / "local" / "docker-compose.database.yaml")]

            if self.api:
                files.append(str(ROOT / "env" / "local" / "docker-compose.cache.yaml"))
                files.append(str(ROOT / "env" / "local" / "docker-compose.server.yaml"))
                overrides += (
                    "  valkey:\n"
                    "    ports: !override []\n"
                    "  server:\n"
                    f"    ports: !override ['127.0.0.1:{self.api_port or ''}:8000']\n"
                    "    environment:\n"
                    "      AUTH_TRUST_GATEWAY: 'true'\n"
                )

            if self.client:
                files.append(str(ROOT / "env" / "local" / "docker-compose.client.yaml"))
                overrides += "  client:\n    ports: !override ['127.0.0.1:4173:8080']\n"

            override.write_text(overrides)
            files.append(str(override))
            compose = DockerCompose(
                str(ROOT),
                compose_file_name=files,
                wait=True,
            )
            self.compose = compose

            try:
                compose.start()
                host = compose.get_service_host("pgbouncer", 6432)
                port = compose.get_service_port("pgbouncer", 6432)
                password = quote(postgres_password(), safe="")
                self.url = f"postgresql://workspace:{password}@{host}:{port}/postgres"

                if self.api:
                    host = compose.get_service_host("server", 8000)
                    port = compose.get_service_port("server", 8000)
                    self.api_url = f"http://{host}:{port}"

                yield self
            finally:
                group = "client-docker-e2e" if self.client else "database-tests"
                artifacts = ROOT / "artifacts" / group / self.name
                artifacts.mkdir(parents=True, exist_ok=True)

                try:
                    (artifacts / "containers.log").write_text(
                        "\n".join(compose.get_logs())
                    )
                finally:
                    compose.stop()

    @contextmanager
    def database(self) -> Iterator[str]:
        """Give each test an independent database reached through the pooler."""
        name = f"test_{uuid4().hex}"

        with psycopg.connect(self.url, autocommit=True, prepare_threshold=None) as db:
            db.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))

        try:
            yield self.url.rsplit("/", 1)[0] + "/" + name
        finally:
            with psycopg.connect(
                self.url, autocommit=True, prepare_threshold=None
            ) as db:
                db.execute(
                    sql.SQL("DROP DATABASE {} WITH (FORCE)").format(
                        sql.Identifier(name)
                    )
                )
