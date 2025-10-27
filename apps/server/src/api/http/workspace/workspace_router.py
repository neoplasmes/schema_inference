from typing import Annotated

from fastapi import APIRouter, Header, Query, Response

from api.http.workspace import manifest_links, node_links, receipt_links, resource_links
from api.schemas.workspace import AnalysisInput, ChangesetInput, DraftInput
from app.use_cases.apply_changeset import ApplyChangeset
from app.use_cases.create_draft import CreateDraft
from app.use_cases.read_workspace import ReadWorkspace
from app.use_cases.start_analysis import StartAnalysis

IdempotencyKey = Annotated[
    str, Header(alias="Idempotency-Key", min_length=1, max_length=200)
]


def create_workspace_router(
    start: StartAnalysis,
    drafts: CreateDraft,
    changes: ApplyChangeset,
    reads: ReadWorkspace,
) -> APIRouter:
    router = APIRouter(prefix="/api/v2", tags=["workspace"])

    @router.get("")
    def workspace():
        return {
            "_links": {
                "analyses": {"href": "/api/v2/analyses"},
                "schemas": {"href": "/api/v2/schemas"},
            }
        }

    @router.post("/analyses", status_code=202)
    def post_analysis(
        body: AnalysisInput, response: Response, idempotency_key: IdempotencyKey
    ):
        resource = start.execute(body.model_dump(), idempotency_key)
        response.headers["Location"] = f"/api/v2/analyses/{resource['id']}"

        return resource_links("analysis", resource)

    @router.get("/analyses/{identifier}")
    def get_analysis(identifier: str):
        return resource_links("analysis", reads.resource("analysis", identifier))

    @router.get("/analyses/{identifier}/revisions/{revision}/manifest")
    def get_analysis_manifest(identifier: str, revision: str, response: Response):
        manifest = reads.analysis_manifest(identifier, revision)
        response.headers["ETag"] = f'"{identifier}:{revision}"'

        return manifest_links(manifest)

    @router.get("/schemas")
    def get_schemas():
        return [resource_links("schema", item) for item in reads.schemas()]

    @router.post("/schemas", status_code=201)
    def post_schema(
        body: DraftInput, response: Response, idempotency_key: IdempotencyKey
    ):
        manifest = drafts.execute(body.model_dump(), idempotency_key)
        snapshot = manifest["snapshot"]
        response.headers["Location"] = f"/api/v2/schemas/{snapshot['id']}"
        response.headers["ETag"] = f'"{snapshot["id"]}:{snapshot["revision"]}"'

        return manifest_links(manifest)

    @router.get("/schemas/{identifier}")
    def get_schema(identifier: str, response: Response):
        resource = reads.resource("schema", identifier)
        response.headers["ETag"] = f'"{identifier}:{resource["revision"]}"'

        return resource_links("schema", resource)

    @router.get("/schemas/{identifier}/revisions/{revision}/manifest")
    def get_manifest(identifier: str, revision: str, response: Response):
        manifest = reads.manifest(identifier, revision)
        response.headers["ETag"] = f'"{identifier}:{revision}"'

        return manifest_links(manifest)

    @router.get("/schemas/{identifier}/revisions/{revision}/nodes/{node_id:path}")
    def get_node(identifier: str, revision: str, node_id: str):
        return node_links(
            reads.node(identifier, revision, node_id), identifier, revision
        )

    @router.get(
        "/schemas/{identifier}/revisions/{revision}/collections/{collection_id:path}/items"
    )
    def get_page(
        identifier: str,
        revision: str,
        collection_id: str,
        limit: Annotated[int, Query(ge=1, le=200)] = 50,
        cursor: Annotated[str | None, Query(max_length=2000)] = None,
    ):
        return reads.page(identifier, revision, collection_id, limit, cursor)

    @router.post("/schemas/{identifier}/changesets", status_code=201)
    def post_changeset(
        identifier: str,
        body: ChangesetInput,
        response: Response,
        if_match: Annotated[str | None, Header()] = None,
    ):
        receipt = changes.execute(identifier, body.model_dump(), if_match)
        response.headers["Location"] = (
            f"/api/v2/schemas/{identifier}/changesets/{receipt['id']}"
        )
        response.headers["ETag"] = f'"{identifier}:{receipt["result"]["revision"]}"'

        return receipt_links(receipt, identifier)

    @router.get("/schemas/{identifier}/changesets/{mutation_id}")
    def get_changeset(identifier: str, mutation_id: str):
        return receipt_links(reads.receipt(identifier, mutation_id), identifier)

    return router
