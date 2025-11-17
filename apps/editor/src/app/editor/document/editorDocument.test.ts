import { describe, expect, it } from 'vitest';
import type { MemberPage } from '../../ports/repos/schema';
import { EditorDocument } from './editorDocument';

function document() {
    return new EditorDocument({
        snapshot: {
            resource: 'schema',
            id: 'orders',
            revision: 's1',
        },
        title: 'Orders',
        rootNodeId: 'root',
        profile: {
            syntax: 'json',
            dialect: 'json-schema-2020-12',
        },
    });
}

function page(name: string, nextCursor: string | null = null): MemberPage {
    return {
        snapshot: {
            resource: 'schema',
            id: 'orders',
            revision: 's1',
        },
        collectionId: 'fields',
        scopeId: null,
        items: [
            {
                member: {
                    id: 'name',
                    kind: 'property',
                    name,
                    required: true,
                    valueNodeId: 'string',
                },
                valueSummary: {
                    id: 'string',
                    kind: 'scalar',
                    label: 'string',
                    directMemberCount: 0,
                    descendantCount: 0,
                },
            },
        ],
        totalItems: 1,
        nextCursor,
    };
}

function currentName(editor: EditorDocument): string | undefined {
    const member = editor.projectedCollections().get('fields')?.items[0]?.member;

    return member?.kind === 'property' ? member.name : undefined;
}

function numberedPage(start: number, end: number, totalItems: number): MemberPage {
    return {
        ...page('unused'),
        totalItems,
        nextCursor: end < totalItems ? String(end) : null,
        items: Array.from(
            {
                length: end - start,
            },
            (_, index) => {
                const id = `field-${start + index}`;

                return {
                    member: {
                        id,
                        kind: 'property' as const,
                        name: id,
                        required: true,
                        valueNodeId: 'string',
                    },
                    valueSummary: {
                        id: 'string',
                        kind: 'scalar' as const,
                        label: 'string',
                        directMemberCount: 0,
                        descendantCount: 0,
                    },
                };
            }
        ),
    };
}

describe('partially loaded document operations', () => {
    it('updates loading state without replacing collection contents or pagination metadata', () => {
        const editor = document();
        editor.addPage(numberedPage(0, 50, 150));
        const previous = editor.collections.get('fields')!;
        const failed = editor.setCollectionLoadState('fields', 'failed', 'Unavailable');
        expect(failed).not.toBe(previous);
        expect(failed).toEqual({
            ...previous,
            state: 'failed',
            error: 'Unavailable',
        });
        expect(failed.items).toBe(previous.items);
        expect(editor.collections.get('fields')).toBe(failed);
        const loading = editor.setCollectionLoadState('fields', 'loading');
        expect(loading).toEqual({
            ...previous,
            state: 'loading',
            error: undefined,
        });
        expect(editor.operations).toHaveLength(0);
        expect(() => editor.setCollectionLoadState('unknown', 'loading')).toThrow(
            'Load the collection'
        );
        expect(editor.collections.has('unknown')).toBe(false);
        expect(editor.collections.get('fields')).toBe(loading);
    });

    it('handles the same definitive rejection twice without losing edits or a fresh retry', () => {
        const editor = document();
        editor.addPage(page('name'));
        editor.rename('name', 'customer');
        editor.beginSave('first');
        editor.failSave('first');
        expect(() => editor.failSave('first')).not.toThrow();
        expect(editor.operations).toHaveLength(1);
        expect(editor.beginSave('second').id).toBe('second');
        expect(() => editor.failSave('first')).toThrow('different save operation');
    });

    it('retains a field with an expanded child when later pages evict ordinary rows', () => {
        const editor = document();
        const retained = new Set([
            'field-0',
        ]);
        editor.addPage(numberedPage(0, 50, 150));
        editor.addPage(numberedPage(50, 100, 150), 'append', retained);
        editor.addPage(numberedPage(100, 150, 150), 'append', retained);
        expect(editor.collections.get('fields')?.items[0].member.id).toBe('field-0');
        expect(editor.collections.get('fields')).toMatchObject({
            loadedItems: 101,
            hasGaps: true,
        });
        expect(editor.operations).toHaveLength(0);
    });

    it('bounds loaded row windows while keeping a renamed field and its undo history', () => {
        const editor = document();
        editor.addPage(numberedPage(0, 50, 200));
        editor.rename('field-0', 'kept');
        editor.addPage(numberedPage(50, 100, 200));
        editor.addPage(numberedPage(100, 150, 200));
        editor.addPage(numberedPage(150, 200, 200));
        expect(editor.collections.get('fields')).toMatchObject({
            state: 'complete',
            totalItems: 200,
            loadedItems: 101,
            hasGaps: true,
        });
        expect(currentName(editor)).toBe('kept');
        editor.undo();
        expect(currentName(editor)).toBe('field-0');
        expect(
            editor.collections
                .get('fields')
                ?.items.some(row => row.member.id === 'field-20')
        ).toBe(false);
    });

    it('marks a reloaded first page with a distant pinned edit as noncontiguous', () => {
        const editor = document();
        editor.addPage(numberedPage(0, 50, 150));
        editor.addPage(numberedPage(50, 100, 150));
        editor.addPage(numberedPage(100, 150, 150));
        editor.rename('field-149', 'kept');
        editor.addPage(numberedPage(0, 50, 150), 'replace');
        expect(editor.collections.get('fields')).toMatchObject({
            loadedItems: 51,
            hasGaps: true,
        });
        expect(() => editor.move('field-149', 'fields', 'field-0')).toThrow('contiguous');
    });

    it('does not infer safe ancestry from a complete collection whose older rows were evicted', () => {
        const editor = document();
        editor.integrateNode({
            id: 'child',
            kind: 'object',
            properties: {
                id: 'fields',
                totalItems: 150,
            },
            additionalProperties: false,
        });
        editor.integrateNode({
            id: 'target',
            kind: 'object',
            properties: {
                id: 'target-fields',
                totalItems: 0,
            },
            additionalProperties: false,
        });
        editor.addPage({
            ...page('parent'),
            collectionId: 'root-fields',
            items: [
                {
                    member: {
                        id: 'parent',
                        kind: 'property',
                        name: 'child',
                        required: true,
                        valueNodeId: 'child',
                    },
                    valueSummary: {
                        id: 'child',
                        kind: 'object',
                        label: 'child',
                        directMemberCount: 150,
                        descendantCount: 150,
                    },
                },
            ],
        });
        editor.addPage(numberedPage(0, 50, 150));
        editor.addPage(numberedPage(50, 100, 150));
        editor.addPage(numberedPage(100, 150, 150));
        editor.addPage({
            ...page('unused'),
            collectionId: 'target-fields',
            items: [],
            totalItems: 0,
        });
        expect(() => editor.move('parent', 'target-fields', null)).toThrow('ancestry');
        expect(editor.operations).toHaveLength(0);
    });

    it('does not turn a page load into an edit or overwrite a local rename', () => {
        const editor = document();
        editor.addPage(page('name', 'next'));
        expect(editor.operations).toHaveLength(0);
        expect(editor.collections.get('fields')?.state).toBe('partial');
        editor.rename('name', 'customer');
        editor.addPage(page('name'));
        expect(currentName(editor)).toBe('customer');
        expect(editor.operations).toHaveLength(1);
    });

    it('rejects a late page from another revision without changing the loaded base', () => {
        const editor = document();
        editor.addPage(page('name'));
        expect(() =>
            editor.addPage({
                ...page('stale'),
                snapshot: {
                    resource: 'schema',
                    id: 'orders',
                    revision: 'old',
                },
            })
        ).toThrow('another schema revision');
        expect(currentName(editor)).toBe('name');
    });

    it('retries an uncertain save with the same mutation and keeps edits made during saving', () => {
        const editor = document();
        editor.addPage(page('name'));
        editor.rename('name', 'customer');
        const first = editor.beginSave('mutation-1');
        editor.rename('name', 'client');
        expect(editor.beginSave('mutation-2')).toEqual(first);
        editor.confirmSave('s2');
        expect(editor.manifest.snapshot.revision).toBe('s2');
        expect(editor.operations).toHaveLength(1);
        expect(currentName(editor)).toBe('client');
    });

    it('undoes a saved edit using a new operation instead of rewriting the confirmed revision', () => {
        const editor = document();
        editor.addPage(page('name'));
        editor.rename('name', 'customer');
        editor.beginSave('mutation-1');
        editor.confirmSave('s2');
        editor.undo();
        expect(editor.manifest.snapshot.revision).toBe('s2');
        expect(editor.operations).toEqual([
            {
                kind: 'renameProperty',
                memberId: 'name',
                name: 'name',
            },
        ]);
        expect(currentName(editor)).toBe('name');
        editor.redo();
        expect(currentName(editor)).toBe('customer');
    });

    it('keeps incomplete collections distinct from empty collections', () => {
        const editor = document();
        editor.addPage({
            ...page('unused', 'next'),
            items: [],
            totalItems: 20,
        });
        expect(editor.collections.get('fields')).toMatchObject({
            state: 'partial',
            totalItems: 20,
            items: [],
        });
        expect(() => editor.rename('missing', 'name')).toThrow('Load the field');
    });

    it('rejects moving a parent field into its own collection', () => {
        const editor = document();
        editor.integrateNode({
            id: 'child',
            kind: 'object',
            properties: {
                id: 'child-fields',
                totalItems: 0,
            },
            additionalProperties: false,
        });
        editor.addPage({
            ...page('child'),
            items: [
                {
                    member: {
                        id: 'parent',
                        kind: 'property',
                        name: 'child',
                        valueNodeId: 'child',
                        required: true,
                    },
                    valueSummary: {
                        id: 'child',
                        kind: 'object',
                        label: 'child',
                        directMemberCount: 0,
                        descendantCount: 0,
                    },
                },
            ],
        });
        editor.addPage({
            ...page('unused'),
            collectionId: 'child-fields',
            items: [],
            totalItems: 0,
        });
        expect(() => editor.move('parent', 'child-fields', null)).toThrow(
            'own descendants'
        );
        expect(editor.operations).toHaveLength(0);
    });

    it('updates collection counts for a transfer and restores them on undo', () => {
        const editor = document();
        editor.integrateNode({
            id: 'root',
            kind: 'object',
            properties: {
                id: 'fields',
                totalItems: 1,
            },
            additionalProperties: false,
        });
        editor.integrateNode({
            id: 'target',
            kind: 'object',
            properties: {
                id: 'target-fields',
                totalItems: 0,
            },
            additionalProperties: false,
        });
        editor.addPage(page('name'));
        editor.addPage({
            ...page('unused'),
            collectionId: 'target-fields',
            items: [],
            totalItems: 0,
        });
        editor.move('name', 'target-fields', null);
        expect(editor.projectedCollections().get('fields')).toMatchObject({
            totalItems: 0,
            items: [],
        });
        expect(editor.projectedCollections().get('target-fields')?.totalItems).toBe(1);
        editor.undo();
        expect(editor.projectedCollections().get('fields')?.totalItems).toBe(1);
        expect(editor.projectedCollections().get('target-fields')).toMatchObject({
            totalItems: 0,
            items: [],
        });
    });
});
