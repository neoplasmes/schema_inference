import type {
    ChangeReceipt,
    EditorResource,
    MemberPage,
    ReadOptions,
    SchemaRepository,
} from '../../application/ports/repos/schema.repo';
import type { SchemaDocument, SchemaNode, Snapshot } from '../../core/schema';

export type FixtureSchema = Readonly<{
    manifest: SchemaDocument;
    nodes: ReadonlyMap<string, SchemaNode>;
    pages: ReadonlyMap<string, MemberPage>;
}>;

/** An explicitly selected, session-local demo repository. */
export class FixtureSchemaRepository implements SchemaRepository {
    constructor(private readonly fixture: FixtureSchema) {}

    async open(
        _resource: Extract<EditorResource, { kind: 'schema' }>,
        options?: ReadOptions
    ): Promise<SchemaDocument> {
        options?.signal?.throwIfAborted();

        return this.fixture.manifest;
    }

    async createFromAnalysis(): Promise<SchemaDocument> {
        return this.fixture.manifest;
    }

    async readNode(
        _snapshot: Snapshot,
        nodeId: string,
        options?: ReadOptions
    ): Promise<SchemaNode> {
        options?.signal?.throwIfAborted();
        const node = this.fixture.nodes.get(nodeId);

        if (!node) {
            if (nodeId.includes('/extra-')) {
                if (nodeId.endsWith('/scalar')) {
                    return {
                        id: nodeId,
                        kind: 'scalar',
                        scalarType: 'string',
                        constraints: {},
                    };
                }

                return {
                    id: nodeId,
                    kind: 'xmlElement',
                    name: { namespaceUri: null, localName: 'field' },
                    contentNodeId: `${nodeId}/scalar`,
                    nillable: false,
                };
            }

            throw new Error('This demo branch has no additional loaded structure.');
        }

        return node;
    }

    async readMembers(
        snapshot: Snapshot,
        collectionId: string,
        cursor: string | null,
        options?: ReadOptions
    ): Promise<MemberPage> {
        options?.signal?.throwIfAborted();
        const page = this.fixture.pages.get(collectionId);

        if (!page) {
            throw new Error('This demo collection is unavailable.');
        }

        if (cursor === null) {
            return { ...page, snapshot };
        }

        const offset = Number(cursor);

        if (
            !Number.isSafeInteger(offset) ||
            offset < page.items.length ||
            offset > page.totalItems
        ) {
            throw new Error('Invalid demo page cursor.');
        }

        const end = Math.min(offset + 50, page.totalItems);
        const items: MemberPage['items'][number][] = [];

        for (let index = offset; index < end; index += 1) {
            const id = `${collectionId}/extra-${index}`;
            items.push({
                member: {
                    id,
                    kind: 'xmlParticle',
                    minOccurs: 0,
                    maxOccurs: 1,
                    valueNodeId: `${id}/value`,
                },
                valueSummary: {
                    id: `${id}/value`,
                    kind: 'xmlElement',
                    label: `field_${index + 1}`,
                    directMemberCount: 0,
                    descendantCount: 0,
                },
            });
        }

        return {
            ...page,
            snapshot,
            items,
            nextCursor: end < page.totalItems ? String(end) : null,
        };
    }

    async save(_snapshot: Snapshot, mutationId: string): Promise<ChangeReceipt> {
        return {
            id: `local-${mutationId}`,
            clientMutationId: mutationId,
            status: 'applied',
            revision: `local-${mutationId}`,
            error: null,
        };
    }

    async readChange(_schemaId: string, changeId: string): Promise<ChangeReceipt> {
        throw new Error(`The local demo has no server changeset ${changeId}.`);
    }
}
