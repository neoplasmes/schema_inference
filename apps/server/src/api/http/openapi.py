import argparse
import sys
from pathlib import Path
from typing import Any, cast

import yaml
from fastapi import FastAPI
from fastapi.routing import APIRoute

from api.http.http_server import create_http_server
from api.http.workspace import create_workspace_router
from api.jobs import SessionCleanupJob
from app.use_cases.apply_changeset import ApplyChangeset
from app.use_cases.cleanup_session import CleanupSession
from app.use_cases.create_draft import CreateDraft
from app.use_cases.generate_schema import GenerateSchema
from app.use_cases.process_documents import ProcessDocuments
from app.use_cases.read_workspace import ReadWorkspace
from app.use_cases.start_analysis import StartAnalysis
from app.use_cases.upload_documents import UploadDocuments

TITLE = "Schema Workspace API"
VERSION = "2.0.0"


def inert[T](kind: type[T]) -> T:
    """Return a placeholder typed as ``kind`` that is never invoked."""

    return cast(T, None)


def annotate_path_params(app: FastAPI) -> None:
    """Record ``:path`` convertor parameters inside each operation's x-cache."""
    for route in app.routes:
        if not isinstance(route, APIRoute) or ":path}" not in route.path:
            continue

        extra = route.openapi_extra or {}
        policy = extra.get("x-cache")

        if policy is None:
            continue

        names = [
            segment.removeprefix("{").removesuffix(":path}")
            for segment in route.path.split("/")
            if segment.startswith("{") and segment.endswith(":path}")
        ]
        route.openapi_extra = {
            **extra,
            "x-cache": {**policy, "pathParams": names},
        }


def build_openapi() -> dict[str, Any]:
    """Build the OpenAPI document without any database or filesystem access."""
    server = create_http_server(
        upload_documents=inert(UploadDocuments),
        process_documents=inert(ProcessDocuments),
        generate_schema=inert(GenerateSchema),
        cleanup_session=inert(CleanupSession),
        cleanup_job=inert(SessionCleanupJob),
        allowed_origins=(),
    )
    server.title = TITLE
    server.version = VERSION
    server.include_router(
        create_workspace_router(
            inert(StartAnalysis),
            inert(CreateDraft),
            inert(ApplyChangeset),
            inert(ReadWorkspace),
        )
    )
    annotate_path_params(server)

    return server.openapi()


def render_openapi() -> str:
    """Render the OpenAPI document as stable YAML."""

    return yaml.safe_dump(
        build_openapi(), sort_keys=False, allow_unicode=True, width=1000
    )


def main(argv: list[str] | None = None) -> int:
    """Write the OpenAPI YAML to a file or verify that the file is current."""
    parser = argparse.ArgumentParser(prog="python -m api.http.openapi")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--check", action="store_true")
    options = parser.parse_args(argv)
    document = render_openapi()

    if options.check:
        current = options.output.read_text() if options.output.exists() else None

        if current != document:
            print(
                f"{options.output} is out of date; "
                "run `moon run server:build-openapi` and commit the result",
                file=sys.stderr,
            )

            return 1

        return 0

    options.output.write_text(document)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
