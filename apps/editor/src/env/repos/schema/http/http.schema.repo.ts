import type {
    ChangeReceipt,
    EditorResource,
    MemberPage,
    ReadOptions,
    SchemaRepository,
} from '../../../../app/ports/repos/schema';
import {
    SchemaWriteRejectedError,
    SchemaRepositoryError,
} from '../../../../app/ports/repos/schema';
import type {
    DocumentOperation,
    SchemaDocument,
    SchemaNode,
    Snapshot,
} from '../../../../core/entities/schema';
import { HttpResponseError, type HttpTransport } from '../../../transport/http';
import {
    object,
    string,
    nullableString,
    count,
    array,
    version,
    parseSnapshot,
    parseManifest,
    parseNode,
    parseMemberSummary,
    parseReceipt,
    ContractViolationError,
} from './contract';

/** Maps the versioned HTTP contract into framework-free application values. */
export class HttpSchemaRepository implements SchemaRepository {
    constructor(private readonly transport: HttpTransport) {}

    async createFromAnalysis(
        resource: Extract<EditorResource, { kind: 'analysis' }>
    ): Promise<SchemaDocument> {
        const analysis = object(
            await this.request(
                `/api/v2/analyses/${encodeURIComponent(resource.analysisId)}/revisions/${encodeURIComponent(resource.revision)}/manifest`
            )
        );
        version(analysis);
        const snapshot = object(analysis.snapshot);

        if (
            analysis.format !== 'schema-analysis' ||
            snapshot.resource !== 'analysis' ||
            snapshot.id !== resource.analysisId ||
            snapshot.revision !== resource.revision
        ) {
            throw new ContractViolationError(
                'The server returned another analysis snapshot.'
            );
        }
        const suggestion = object(analysis.suggestedDraft);
        const rootAlternativeId =
            resource.rootAlternativeId ??
            nullableString(suggestion.suggestedRootAlternativeId);

        if (rootAlternativeId === null) {
            throw new SchemaRepositoryError(
                'alternative_required',
                'No root alternative was selected.'
            );
        }

        return parseManifest(
            await this.request('/api/v2/schemas', {
                method: 'POST',
                body: JSON.stringify({
                    title: 'Untitled schema',
                    source: {
                        kind: 'analysis',
                        analysisId: resource.analysisId,
                        revision: resource.revision,
                        seedId: string(suggestion.seedId),
                        rootAlternativeId,
                    },
                }),
            })
        );
    }

    async open(
        resource: Extract<EditorResource, { kind: 'schema' }>,
        options?: ReadOptions
    ): Promise<SchemaDocument> {
        const schemaId = encodeURIComponent(resource.schemaId);
        const revision =
            resource.revision ??
            string(
                object(await this.request(`/api/v2/schemas/${schemaId}`, options))
                    .revision
            );

        const document = parseManifest(
            await this.request(
                `/api/v2/schemas/${schemaId}/revisions/${encodeURIComponent(revision)}/manifest`,
                options
            )
        );

        if (
            document.snapshot.id !== resource.schemaId ||
            document.snapshot.revision !== revision
        ) {
            throw new ContractViolationError(
                'The server returned another schema snapshot.'
            );
        }

        return document;
    }

    async readNode(
        snapshot: Snapshot,
        nodeId: string,
        options?: ReadOptions
    ): Promise<SchemaNode> {
        const node = parseNode(
            await this.request(
                `${snapshotPath(snapshot)}/nodes/${encodeURIComponent(nodeId)}`,
                options
            )
        );

        if (node.id !== nodeId) {
            throw new ContractViolationError('The server returned another schema node.');
        }

        return node;
    }

    async readMembers(
        snapshot: Snapshot,
        collectionId: string,
        cursor: string | null,
        options?: ReadOptions
    ): Promise<MemberPage> {
        const query = new URLSearchParams({ limit: '50' });

        if (cursor !== null) {
            query.set('cursor', cursor);
        }

        const value = object(
            await this.request(
                `${snapshotPath(snapshot)}/collections/${encodeURIComponent(collectionId)}/items?${query}`,
                options
            )
        );
        version(value);
        const pageSnapshot = parseSnapshot(value.snapshot);

        if (
            pageSnapshot.id !== snapshot.id ||
            pageSnapshot.revision !== snapshot.revision ||
            value.collectionId !== collectionId ||
            value.scopeId !== null
        ) {
            throw new ContractViolationError(
                'The server returned a page from another resource or context.'
            );
        }

        const totalItems = count(value.totalItems);
        const items = array(value.items).map(parseMemberSummary);

        if (
            items.length > 50 ||
            items.length > totalItems ||
            new Set(items.map(item => item.member.id)).size !== items.length
        ) {
            throw new ContractViolationError(
                'The server returned an invalid member page.'
            );
        }

        return {
            snapshot: pageSnapshot,
            collectionId,
            scopeId: null,
            items,
            totalItems,
            nextCursor: nullableString(value.nextCursor),
        };
    }

    async save(
        snapshot: Snapshot,
        mutationId: string,
        operations: readonly DocumentOperation[]
    ): Promise<ChangeReceipt> {
        return parseReceipt(
            await this.request(
                `/api/v2/schemas/${encodeURIComponent(snapshot.id)}/changesets`,
                {
                    method: 'POST',
                    headers: {
                        'If-Match': JSON.stringify(`${snapshot.id}:${snapshot.revision}`),
                    },
                    body: JSON.stringify({
                        clientMutationId: mutationId,
                        baseRevision: snapshot.revision,
                        operations,
                    }),
                }
            )
        );
    }

    async readChange(
        schemaId: string,
        changeId: string,
        options?: ReadOptions
    ): Promise<ChangeReceipt> {
        return parseReceipt(
            await this.request(
                `/api/v2/schemas/${encodeURIComponent(schemaId)}/changesets/${encodeURIComponent(changeId)}`,
                options
            )
        );
    }

    private async request(path: string, options?: RequestInit): Promise<unknown> {
        try {
            const response = await this.transport.request(path, options);

            return (await response.json()) as unknown;
        } catch (error) {
            if (error instanceof HttpResponseError) {
                if (error.status === 404) {
                    throw new SchemaRepositoryError(
                        'unavailable',
                        'Schema resource unavailable.',
                        error.status
                    );
                }

                if (error.status === 409 || error.status === 412) {
                    throw new SchemaWriteRejectedError(
                        'conflict',
                        'Schema revision conflict.'
                    );
                }

                if (
                    options?.method === 'POST' &&
                    (error.status === 400 || error.status === 422)
                ) {
                    throw new SchemaWriteRejectedError(
                        'invalid',
                        'Schema changes rejected.'
                    );
                }
            }

            throw error;
        }
    }
}

function snapshotPath(snapshot: Snapshot): string {
    return `/api/v2/schemas/${encodeURIComponent(snapshot.id)}/revisions/${encodeURIComponent(snapshot.revision)}`;
}
