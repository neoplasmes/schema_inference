import { describe, expect, it, vi } from 'vitest';
import type { SchemaNode } from '../../../core/entities/schema';
import type { SchemaRepository } from '../../ports/repos/schema';
import { LoadBranchQuery } from '.';

const snapshot = {
    resource: 'schema',
    id: 'orders',
    revision: 's1',
} as const;

function repository(nodes: readonly SchemaNode[]): SchemaRepository {
    return {
        open: vi.fn(),
        createFromAnalysis: vi.fn(),
        readNode: vi.fn(async (_snapshot, id) => {
            const node = nodes.find(value => value.id === id);

            if (!node) {
                throw new Error(`Unknown node ${id}`);
            }

            return node;
        }),
        readMembers: vi.fn(async (snapshot, collectionId) => ({
            snapshot,
            collectionId,
            scopeId: null,
            items: [],
            totalItems: 0,
            nextCursor: null,
        })),
        save: vi.fn(),
        readChange: vi.fn(),
    };
}

describe('load branch query', () => {
    it('declares the snapshot read while loading wrapper nodes and their collections', async () => {
        const repo = repository([
            {
                id: 'element',
                kind: 'xmlElement',
                name: {
                    namespaceUri: null,
                    localName: 'Order',
                },
                contentNodeId: 'complex',
                nillable: false,
            },
            {
                id: 'complex',
                kind: 'xmlComplex',
                attributes: {
                    id: 'attributes',
                    totalItems: 0,
                },
                particleNodeId: 'group',
                mixed: false,
            },
            {
                id: 'group',
                kind: 'xmlGroup',
                compositor: 'sequence',
                particles: {
                    id: 'particles',
                    totalItems: 0,
                },
            },
        ]);
        const query = new LoadBranchQuery(repo);
        const options = {
            signal: new AbortController().signal,
        };
        const input = {
            snapshot,
            nodeId: 'element',
        };
        const branch = await query.execute(input, options);
        expect(branch.title).toBe('Order');
        expect(branch.nodes.map(node => node.id)).toEqual([
            'element',
            'complex',
            'group',
        ]);
        expect(branch.pages.map(page => page.collectionId)).toEqual([
            'attributes',
            'particles',
        ]);
        expect(repo.readNode).toHaveBeenLastCalledWith(snapshot, 'group', options);
        expect(repo.readMembers).toHaveBeenLastCalledWith(
            snapshot,
            'particles',
            null,
            options
        );
        expect(query.reads(input)).toEqual([
            'schema.snapshot:orders/s1',
        ]);
    });

    it('loads simple XML content alongside its attributes', async () => {
        const nodes = [
            {
                id: 'price',
                kind: 'xmlComplex',
                attributes: {
                    id: 'attributes',
                    totalItems: 0,
                },
                particleNodeId: null,
                simpleContentNodeId: 'amount',
                mixed: false,
            },
            {
                id: 'amount',
                kind: 'scalar',
                scalarType: 'decimal',
                constraints: {},
            },
        ] as const;
        const branch = await new LoadBranchQuery(repository(nodes)).execute({
            snapshot,
            nodeId: 'price',
        });

        expect(branch.nodes.map(node => node.id)).toEqual([
            'price',
            'amount',
        ]);
        expect(branch.pages.map(page => page.collectionId)).toEqual([
            'attributes',
        ]);
    });

    it('loads deep array wrappers accepted by the schema API', async () => {
        const nodes: SchemaNode[] = Array.from(
            {
                length: 12,
            },
            (_, index) => ({
                id: `array-${index}`,
                kind: 'array',
                itemsNodeId: index === 11 ? 'object' : `array-${index + 1}`,
                minItems: 0,
                maxItems: null,
            })
        );
        nodes.push({
            id: 'object',
            kind: 'object',
            properties: {
                id: 'fields',
                totalItems: 0,
            },
            additionalProperties: false,
        });
        const branch = await new LoadBranchQuery(repository(nodes)).execute({
            snapshot,
            nodeId: 'array-0',
        });

        expect(branch.nodes).toHaveLength(13);
        expect(branch.pages.map(page => page.collectionId)).toEqual([
            'fields',
        ]);
    });

    it('rejects wrapper chains beyond the API depth limit', async () => {
        const nodes: SchemaNode[] = Array.from(
            {
                length: 129,
            },
            (_, index) => ({
                id: `array-${index}`,
                kind: 'array',
                itemsNodeId: `array-${index + 1}`,
                minItems: 0,
                maxItems: null,
            })
        );
        const repo = repository(nodes);

        await expect(
            new LoadBranchQuery(repo).execute({
                snapshot,
                nodeId: 'array-0',
            })
        ).rejects.toThrow('excessively deep');
        expect(repo.readNode).toHaveBeenCalledTimes(128);
    });

    it('stops a cyclic wrapper chain before issuing repeated reads', async () => {
        const repo = repository([
            {
                id: 'array',
                kind: 'array',
                itemsNodeId: 'array',
                minItems: 0,
                maxItems: null,
            },
        ]);
        await expect(
            new LoadBranchQuery(repo).execute({
                snapshot,
                nodeId: 'array',
            })
        ).rejects.toThrow('invalid or excessively deep content wrapper chain');
        expect(repo.readNode).toHaveBeenCalledTimes(1);
    });
});
