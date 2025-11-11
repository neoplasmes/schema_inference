import logging
from dataclasses import asdict
from io import BytesIO

from app.ports.tools.document_reader import DocumentReaderTool, InvalidDocumentError
from app.ports.uow.workspace import WorkspaceUow
from app.use_cases.infer_schema import InferSchema, InferSchemaError
from app.use_cases.workspace_support import digest
from core.processes.build_schema_draft import build_schema_draft

MAX_ATTEMPTS = 3


class RunAnalysis:
    """Publish inference evidence and observed whole-document alternatives atomically."""

    def __init__(
        self, store: WorkspaceUow, reader: DocumentReaderTool, inference: InferSchema
    ) -> None:
        self._store = store
        self._reader = reader
        self._inference = inference

    def pending(self) -> list[str]:
        """Return identifiers of analyses that still need to run."""
        with self._store.read() as repository:
            return repository.pending_analyses()

    def execute(self, identifier: str) -> None:
        """Run one analysis, logging any failure instead of losing it."""
        try:
            self._execute(identifier)
        except Exception:
            logging.getLogger(__name__).exception(
                "Analysis %s could not be executed", identifier
            )

    def _execute(self, identifier: str) -> None:
        with self._store.transaction() as repository:
            resource = repository.resource("analysis", identifier)

            if resource["status"] not in ("queued", "processing"):
                return

            attempts = resource.get("attempts", 0) + 1

            if attempts > MAX_ATTEMPTS:
                resource.update(
                    status="failed",
                    error="Analysis was interrupted too many times.",
                    progress=100,
                )
                repository.put_resource("analysis", resource)

                return

            resource.update(status="processing", progress=10, attempts=attempts)
            repository.put_resource("analysis", resource)

        try:
            documents = resource["documents"]
            roots = [
                self._reader.read(
                    BytesIO(item["content"].encode()), f"input.{item['format']}"
                )
                for item in documents
            ]
            evidence = self._inference.analyze(roots)
            formats = sorted({item["format"] for item in documents})
            syntax = (
                "xml"
                if formats == ["xml"]
                else "yaml"
                if formats == ["yaml"]
                else "json"
            )
            alternatives = {}

            for root in roots:
                graph = asdict(build_schema_draft(root, syntax))
                key = "alternative-" + digest(graph)[:24]
                alternative = alternatives.setdefault(
                    key, {"id": key, "count": 0, "graph": graph}
                )
                alternative["count"] += 1

            selected = min(
                alternatives.values(), key=lambda item: (-item["count"], item["id"])
            )
            manifest = {
                "contractVersion": 2,
                "format": "schema-analysis",
                "title": resource["title"],
                "snapshot": {
                    "resource": "analysis",
                    "id": identifier,
                    "revision": resource["revision"],
                },
                "inputFormats": formats,
                "profile": selected["graph"]["profile"],
                "statistics": {"documents": len(roots), "fields": len(evidence.nodes)},
                "recipeVersion": "observed-document-v1",
                "suggestedDraft": {
                    "seedId": "observed-document-v1",
                    "suggestedRootAlternativeId": selected["id"],
                },
                "rootAlternatives": [
                    {"id": item["id"], "count": item["count"]}
                    for item in alternatives.values()
                ],
            }
            result = {
                "manifest": manifest,
                "alternatives": alternatives,
                "evidence": asdict(evidence),
            }

            with self._store.transaction() as repository:
                if repository.resource("analysis", identifier)["status"] == "completed":
                    return

                repository.put_analysis_result(identifier, result)
                resource.update(status="completed", progress=100)
                repository.put_resource("analysis", resource)
        except (
            InvalidDocumentError,
            InferSchemaError,
            ValueError,
            RecursionError,
        ) as error:
            self._fail(resource, str(error))
        except Exception:
            logging.getLogger(__name__).exception("Analysis %s failed", identifier)
            self._fail(resource, "Analysis could not be completed.")

    def _fail(self, resource, message: str) -> None:
        resource.update(status="failed", error=message, progress=100)

        try:
            with self._store.transaction() as repository:
                current = repository.resource("analysis", resource["id"])

                if current["status"] == "completed":
                    return

                repository.put_resource("analysis", resource)
        except Exception:
            logging.getLogger(__name__).exception(
                "Analysis %s could not be marked as failed", resource["id"]
            )
