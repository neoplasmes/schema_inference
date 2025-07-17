import type {
    ChangeReceipt,
    EditorResource,
    MemberPage,
    ReadOptions,
    SchemaRepository,
} from '../../application/ports/repos/schema.repo';
import type {
    Collection,
    DocumentOperation,
    ExpandedName,
    MemberSummary,
    SchemaDocument,
    SchemaMember,
    SchemaNode,
    SchemaProfile,
    Snapshot,
} from '../../core/schema';
import { SchemaWriteRejectedError } from '../../application/ports/repos/schema.repo.error';
import type { HttpTransport } from '../transport/http.transport';

type ObjectValue = Record<string, unknown>;

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
            throw new Error('The server returned another analysis snapshot.');
        }
        const suggestion = object(analysis.suggestedDraft);
        const rootAlternativeId =
            resource.rootAlternativeId ??
            nullableString(suggestion.suggestedRootAlternativeId);

        if (rootAlternativeId === null) {
            throw new Error('Choose a root alternative before creating a draft.');
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
            throw new Error('The server returned another schema snapshot.');
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
            throw new Error('The server returned another schema node.');
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
            throw new Error(
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
            throw new Error('The server returned an invalid member page.');
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
        const response = await this.transport.request(path, options);

        if (!response.ok) {
            if (response.status === 404) {
                throw new Error(
                    'The schema API is unavailable or this resource no longer exists. The editor requires API v2.'
                );
            }

            if (response.status === 409 || response.status === 412) {
                throw new SchemaWriteRejectedError(
                    'conflict',
                    'The schema has changed on the server. Your local edits are preserved; reconcile before saving.'
                );
            }

            if (
                options?.method === 'POST' &&
                (response.status === 400 || response.status === 422)
            ) {
                throw new SchemaWriteRejectedError(
                    'invalid',
                    'The server rejected these schema edits. Correct them before saving again.'
                );
            }

            throw new Error(
                `The schema request failed (${response.status}). Your local edits are preserved.`
            );
        }

        return response.json() as Promise<unknown>;
    }
}

function snapshotPath(snapshot: Snapshot): string {
    return `/api/v2/schemas/${encodeURIComponent(snapshot.id)}/revisions/${encodeURIComponent(snapshot.revision)}`;
}

function object(value: unknown): ObjectValue {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error('Invalid schema API object.');
    }

    return value as ObjectValue;
}

function string(value: unknown): string {
    if (typeof value !== 'string') {
        throw new Error('Invalid schema API string.');
    }

    return value;
}

function nullableString(value: unknown): string | null {
    return value === null ? null : string(value);
}

function count(value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        throw new Error('Invalid schema API count.');
    }

    return value;
}

function boolean(value: unknown): boolean {
    if (typeof value !== 'boolean') {
        throw new Error('Invalid schema API boolean.');
    }

    return value;
}

function array(value: unknown): unknown[] {
    if (!Array.isArray(value)) {
        throw new Error('Invalid schema API array.');
    }

    return value;
}

function version(value: ObjectValue): void {
    if (value.contractVersion !== 2) {
        throw new Error('Unsupported schema API contract version.');
    }
}

function parseSnapshot(value: unknown): Snapshot {
    const data = object(value);

    if (data.resource !== 'schema') {
        throw new Error('Expected a schema snapshot.');
    }

    return { resource: 'schema', id: string(data.id), revision: string(data.revision) };
}

function parseManifest(value: unknown): SchemaDocument {
    const data = object(value);
    version(data);

    if (data.format !== 'schema-draft') {
        throw new Error('Expected an editable schema manifest.');
    }

    const profile = object(data.profile);
    let parsedProfile: SchemaProfile;

    if (profile.syntax === 'xml' && profile.dialect === 'xsd-1.0') {
        parsedProfile = { syntax: 'xml', dialect: 'xsd-1.0' };
    } else if (
        (profile.syntax === 'json' || profile.syntax === 'yaml') &&
        profile.dialect === 'json-schema-2020-12'
    ) {
        parsedProfile = { syntax: profile.syntax, dialect: 'json-schema-2020-12' };
    } else {
        throw new Error('Unsupported schema profile.');
    }

    return {
        snapshot: parseSnapshot(data.snapshot),
        title: string(data.title),
        rootNodeId: string(data.rootNodeId),
        profile: parsedProfile,
    };
}

function parseCollection(value: unknown): Collection {
    const data = object(value);

    return { id: string(data.id), totalItems: count(data.totalItems) };
}

function parseName(value: unknown): ExpandedName {
    const data = object(value);

    return {
        namespaceUri: nullableString(data.namespaceUri),
        localName: string(data.localName),
    };
}

function nodeKind(value: unknown): SchemaNode['kind'] {
    switch (value) {
        case 'scalar':
        case 'object':
        case 'array':
        case 'union':
        case 'ref':
        case 'xmlElement':
        case 'xmlComplex':
        case 'xmlGroup':
            return value;
        default:
            throw new Error('Unsupported schema node kind.');
    }
}

function parseNode(value: unknown): SchemaNode {
    const data = object(value);
    const id = string(data.id);
    const kind = nodeKind(data.kind);

    switch (kind) {
        case 'scalar': {
            const type = data.scalarType;

            if (
                type !== 'string' &&
                type !== 'integer' &&
                type !== 'number' &&
                type !== 'decimal' &&
                type !== 'boolean' &&
                type !== 'null' &&
                type !== 'date' &&
                type !== 'datetime'
            ) {
                throw new Error('Unsupported scalar type.');
            }

            return { id, kind, scalarType: type, constraints: object(data.constraints) };
        }
        case 'object':
            return {
                id,
                kind,
                properties: parseCollection(data.properties),
                additionalProperties: boolean(data.additionalProperties),
            };
        case 'array':
            return {
                id,
                kind,
                itemsNodeId: string(data.itemsNodeId),
                minItems: count(data.minItems),
                maxItems: data.maxItems === null ? null : count(data.maxItems),
            };
        case 'union': {
            if (data.mode !== 'anyOf' && data.mode !== 'oneOf') {
                throw new Error('Unsupported union mode.');
            }

            return { id, kind, mode: data.mode, options: parseCollection(data.options) };
        }
        case 'ref':
            return { id, kind, definitionId: string(data.definitionId) };
        case 'xmlElement':
            return {
                id,
                kind,
                name: parseName(data.name),
                contentNodeId: string(data.contentNodeId),
                nillable: boolean(data.nillable),
            };
        case 'xmlComplex':
            return {
                id,
                kind,
                attributes: parseCollection(data.attributes),
                particleNodeId: nullableString(data.particleNodeId),
                mixed: boolean(data.mixed),
            };
        case 'xmlGroup': {
            if (
                data.compositor !== 'sequence' &&
                data.compositor !== 'choice' &&
                data.compositor !== 'all'
            ) {
                throw new Error('Unsupported XML group.');
            }

            return {
                id,
                kind,
                compositor: data.compositor,
                particles: parseCollection(data.particles),
            };
        }
    }
}

function parseMemberSummary(value: unknown): MemberSummary {
    const data = object(value);
    const member = object(data.member);
    const summary = object(data.valueSummary);
    const id = string(member.id);
    const valueNodeId = string(member.valueNodeId);
    let parsed: SchemaMember;

    switch (member.kind) {
        case 'property':
            parsed = {
                id,
                valueNodeId,
                kind: 'property',
                name: string(member.name),
                required: boolean(member.required),
            };
            break;
        case 'option':
            parsed = { id, valueNodeId, kind: 'option', title: string(member.title) };
            break;
        case 'xmlAttribute':
            parsed = {
                id,
                valueNodeId,
                kind: 'xmlAttribute',
                name: parseName(member.name),
                required: boolean(member.required),
            };
            break;
        case 'xmlParticle':
            parsed = {
                id,
                valueNodeId,
                kind: 'xmlParticle',
                minOccurs: count(member.minOccurs),
                maxOccurs: member.maxOccurs === null ? null : count(member.maxOccurs),
            };
            break;
        default:
            throw new Error('Unsupported schema member kind.');
    }

    if (summary.id !== valueNodeId) {
        throw new Error('The member summary does not describe its value.');
    }

    return {
        member: parsed,
        valueSummary: {
            id: valueNodeId,
            kind: nodeKind(summary.kind),
            label: string(summary.label),
            directMemberCount: count(summary.directMemberCount),
            descendantCount:
                summary.descendantCount === null ? null : count(summary.descendantCount),
        },
    };
}

function parseReceipt(value: unknown): ChangeReceipt {
    const data = object(value);
    const status = data.status;

    if (
        status !== 'pending' &&
        status !== 'applied' &&
        status !== 'failed' &&
        status !== 'conflicted'
    ) {
        throw new Error('Unsupported changeset status.');
    }

    return {
        id: string(data.id),
        clientMutationId: string(data.clientMutationId),
        status,
        revision: data.result == null ? null : string(object(data.result).revision),
        error: typeof data.error === 'string' ? data.error : null,
    };
}
