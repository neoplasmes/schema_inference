from typing import Any

from app.ports.repos.workspace import WorkspaceError
from app.ports.tools.analysis_jobs import AnalysisJobs
from app.ports.uow.workspace import WorkspaceUow
from app.use_cases.workspace_support import digest, identifier, timestamp


class StartAnalysis:
    """Persist accepted documents before scheduling analysis, deduplicating retries."""

    def __init__(self, store: WorkspaceUow, jobs: AnalysisJobs) -> None:
        self._store = store
        self._jobs = jobs

    def execute(self, body: dict[str, Any], key: str) -> dict[str, Any]:
        formats = {document["format"] for document in body["documents"]}

        if "xml" in formats and len(formats) > 1:
            raise WorkspaceError(
                "invalid_input", "XML and JSON/YAML require separate analyses."
            )

        fingerprint = digest(body)

        with self._store.transaction() as repository:
            replay = repository.replay("analyses", key, fingerprint)

            if replay is not None:
                return repository.resource("analysis", replay)

            resource = {
                "id": identifier("analysis"),
                "title": body["title"],
                "revision": "a1",
                "created_at": timestamp(),
                "status": "queued",
                "progress": 0,
                "error": None,
                "documents": [
                    {**document, "id": identifier("document")}
                    for document in body["documents"]
                ],
            }
            repository.put_resource("analysis", resource)
            repository.remember("analyses", key, fingerprint, resource["id"])

        self._jobs.submit(resource["id"])

        return resource
