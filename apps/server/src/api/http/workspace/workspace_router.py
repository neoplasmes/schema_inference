from typing import Annotated

from fastapi import APIRouter, Header, Query, Response

from api.http.cache import cache_policy
from api.http.principal import Actor
from api.http.workspace import manifest_links, node_links, receipt_links, resource_links
from api.schemas.workspace import AnalysisInput, ChangesetInput, DraftInput
from app.use_cases.apply_changeset import ApplyChangeset
from app.use_cases.create_draft import CreateDraft
from app.use_cases.delete_analysis import DeleteAnalysis
from app.use_cases.delete_schema import DeleteSchema
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
    delete_schema: DeleteSchema,
    delete_analysis: DeleteAnalysis,
) -> APIRouter:
    router = APIRouter(prefix="/api/v2", tags=["workspace"])

    @router.get("", openapi_extra=cache_policy("bypass"))
    def workspace():
        return {
            "_links": {
                "analyses": {"href": "/api/v2/analyses"},
                "schemas": {"href": "/api/v2/schemas"},
            }
        }

    @router.get(
        "/analyses",
        openapi_extra=cache_policy("revalidate", tags=["analyses"], vary_user=True),
    )
    def get_analyses(principal: Actor):
        return [resource_links("analysis", item) for item in reads.analyses(principal)]

    @router.post(
        "/analyses",
        status_code=202,
        openapi_extra=cache_policy("bypass", invalidates=["analyses"]),
    )
    def post_analysis(
        body: AnalysisInput,
        response: Response,
        idempotency_key: IdempotencyKey,
        principal: Actor,
    ):
        resource = start.execute(body.model_dump(), idempotency_key, principal)
        response.headers["Location"] = f"/api/v2/analyses/{resource['id']}"

        return resource_links("analysis", resource)

    @router.get("/analyses/{identifier}", openapi_extra=cache_policy("bypass"))
    def get_analysis(identifier: str, principal: Actor):
        return resource_links(
            "analysis", reads.resource("analysis", identifier, principal)
        )

    @router.delete(
        "/analyses/{identifier}",
        status_code=204,
        openapi_extra=cache_policy(
            "bypass", invalidates=["analyses", "analysis:{identifier}"]
        ),
    )
    def remove_analysis(identifier: str, principal: Actor):
        delete_analysis.execute(identifier, principal)

        return Response(status_code=204)

    @router.get(
        "/analyses/{identifier}/revisions/{revision}/manifest",
        openapi_extra=cache_policy("immutable", tags=["analysis:{identifier}"]),
    )
    def get_analysis_manifest(
        identifier: str, revision: str, response: Response, principal: Actor
    ):
        manifest = reads.analysis_manifest(identifier, revision, principal)
        response.headers["ETag"] = f'"{identifier}:{revision}"'

        return manifest_links(manifest)

    @router.get(
        "/schemas",
        openapi_extra=cache_policy("revalidate", tags=["schemas"], vary_user=True),
    )
    def get_schemas(principal: Actor):
        return [resource_links("schema", item) for item in reads.schemas(principal)]

    @router.post(
        "/schemas",
        status_code=201,
        openapi_extra=cache_policy("bypass", invalidates=["schemas"]),
    )
    def post_schema(
        body: DraftInput,
        response: Response,
        idempotency_key: IdempotencyKey,
        principal: Actor,
    ):
        manifest = drafts.execute(body.model_dump(), idempotency_key, principal)
        snapshot = manifest["snapshot"]
        response.headers["Location"] = f"/api/v2/schemas/{snapshot['id']}"
        response.headers["ETag"] = f'"{snapshot["id"]}:{snapshot["revision"]}"'

        return manifest_links(manifest)

    @router.get(
        "/schemas/{identifier}",
        openapi_extra=cache_policy("revalidate", tags=["schema:{identifier}"]),
    )
    def get_schema(identifier: str, response: Response, principal: Actor):
        resource = reads.resource("schema", identifier, principal)
        response.headers["ETag"] = f'"{identifier}:{resource["revision"]}"'

        return resource_links("schema", resource)

    @router.delete(
        "/schemas/{identifier}",
        status_code=204,
        openapi_extra=cache_policy(
            "bypass", invalidates=["schemas", "schema:{identifier}"]
        ),
    )
    def remove_schema(
        identifier: str,
        principal: Actor,
        if_match: Annotated[str | None, Header()] = None,
    ):
        delete_schema.execute(identifier, if_match, principal)

        return Response(status_code=204)

    @router.get(
        "/schemas/{identifier}/revisions/{revision}/manifest",
        openapi_extra=cache_policy("immutable", tags=["schema:{identifier}"]),
    )
    def get_manifest(
        identifier: str, revision: str, response: Response, principal: Actor
    ):
        manifest = reads.manifest(identifier, revision, principal)
        response.headers["ETag"] = f'"{identifier}:{revision}"'

        return manifest_links(manifest)

    @router.get(
        "/schemas/{identifier}/revisions/{revision}/nodes/{node_id:path}",
        openapi_extra=cache_policy("immutable", tags=["schema:{identifier}"]),
    )
    def get_node(identifier: str, revision: str, node_id: str, principal: Actor):
        return node_links(
            reads.node(identifier, revision, node_id, principal), identifier, revision
        )

    @router.get(
        "/schemas/{identifier}/revisions/{revision}/collections/{collection_id:path}/items",
        openapi_extra=cache_policy("immutable", tags=["schema:{identifier}"]),
    )
    def get_page(
        identifier: str,
        revision: str,
        collection_id: str,
        principal: Actor,
        limit: Annotated[int, Query(ge=1, le=200)] = 50,
        cursor: Annotated[str | None, Query(max_length=2000)] = None,
    ):
        return reads.page(identifier, revision, collection_id, limit, cursor, principal)

    @router.post(
        "/schemas/{identifier}/changesets",
        status_code=201,
        openapi_extra=cache_policy(
            "bypass", invalidates=["schemas", "schema:{identifier}"]
        ),
    )
    def post_changeset(
        identifier: str,
        body: ChangesetInput,
        response: Response,
        principal: Actor,
        if_match: Annotated[str | None, Header()] = None,
    ):
        receipt = changes.execute(identifier, body.model_dump(), if_match, principal)
        response.headers["Location"] = (
            f"/api/v2/schemas/{identifier}/changesets/{receipt['id']}"
        )
        response.headers["ETag"] = f'"{identifier}:{receipt["result"]["revision"]}"'

        return receipt_links(receipt, identifier)

    @router.get(
        "/schemas/{identifier}/changesets/{mutation_id}",
        openapi_extra=cache_policy("ttl", ttl=86400, tags=["schema:{identifier}"]),
    )
    def get_changeset(identifier: str, mutation_id: str, principal: Actor):
        return receipt_links(
            reads.receipt(identifier, mutation_id, principal), identifier
        )

    return router
