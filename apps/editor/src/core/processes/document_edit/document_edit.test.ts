import { describe, expect, it } from 'vitest';
import type { MemberSummary, SchemaNode } from '../../entities/schema';
import {
    createMoveEdit,
    createRenameEdit,
    projectCollections,
    type DocumentEditState,
    type EditableCollection,
} from './index';

function property(id: string, valueNodeId = 'string'): MemberSummary {
    return {
        member: { id, kind: 'property', name: id, required: true, valueNodeId },
        valueSummary: {
            id: valueNodeId,
            kind: 'scalar',
            label: 'string',
            directMemberCount: 0,
            descendantCount: 0,
        },
    };
}

function collection(
    collectionId: string,
    items: readonly MemberSummary[],
    extra: Partial<EditableCollection> = {}
): EditableCollection {
    return {
        collectionId,
        items,
        totalItems: items.length,
        available: true,
        complete: true,
        contiguous: true,
        ...extra,
    };
}

function state(
    collections: readonly EditableCollection[],
    nodes: readonly SchemaNode[] = []
): DocumentEditState {
    return {
        collections: new Map(collections.map(value => [value.collectionId, value])),
        nodes: new Map(nodes.map(node => [node.id, node])),
    };
}

function owner(id: string, collectionId: string): SchemaNode {
    return {
        id,
        kind: 'object',
        properties: { id: collectionId, totalItems: 0 },
        additionalProperties: false,
    };
}

describe('document edit processes', () => {
    it('renames an XML attribute without changing its namespace or source data', () => {
        const row: MemberSummary = {
            ...property('code'),
            member: {
                id: 'code',
                kind: 'xmlAttribute',
                name: { namespaceUri: 'urn:orders', localName: 'code' },
                required: true,
                valueNodeId: 'string',
            },
        };
        const document = state([collection('attributes', [row])]);
        const original = structuredClone(document);
        const edit = createRenameEdit(document, 'code', 'number');
        expect(edit).not.toBeNull();
        const renamed = projectCollections(document.collections, [edit!.forward]);
        expect(renamed.get('attributes')?.items[0].member).toMatchObject({
            name: { namespaceUri: 'urn:orders', localName: 'number' },
        });
        expect(projectCollections(renamed, [edit!.inverse])).toEqual(
            document.collections
        );
        expect(document).toEqual(original);
    });

    it('uses the projected XML name for the inverse of a later rename', () => {
        const row: MemberSummary = {
            member: {
                id: 'element-field',
                kind: 'xmlParticle',
                valueNodeId: 'element',
                minOccurs: 1,
                maxOccurs: 1,
            },
            valueSummary: {
                id: 'element',
                kind: 'xmlElement',
                label: 'current',
                directMemberCount: 0,
                descendantCount: 0,
            },
        };
        const document = state(
            [collection('particles', [row])],
            [
                {
                    id: 'element',
                    kind: 'xmlElement',
                    name: { namespaceUri: 'urn:orders', localName: 'original' },
                    contentNodeId: 'string',
                    nillable: false,
                },
            ]
        );
        const edit = createRenameEdit(document, 'element-field', 'next');
        expect(edit?.inverse).toMatchObject({
            kind: 'renameXmlName',
            name: { namespaceUri: 'urn:orders', localName: 'current' },
        });
        expect(createRenameEdit(document, 'element-field', 'current')).toBeNull();
    });

    it('projects and reverses a transfer without changing either source collection', () => {
        const document = state(
            [
                collection('source', [property('first'), property('second')]),
                collection('target', [property('last')]),
            ],
            [owner('source-node', 'source'), owner('target-node', 'target')]
        );
        const original = structuredClone(document);
        const edit = createMoveEdit(document, 'first', 'target', 'last');
        expect(edit?.inverse).toMatchObject({
            targetCollectionId: 'source',
            beforeMemberId: 'second',
        });
        const moved = projectCollections(document.collections, [edit!.forward]);
        expect(moved.get('source')?.totalItems).toBe(1);
        expect(moved.get('target')?.items.map(row => row.member.id)).toEqual([
            'first',
            'last',
        ]);
        expect(projectCollections(moved, [edit!.inverse])).toEqual(document.collections);
        expect(document).toEqual(original);
    });

    it('requires known sibling order before moving the last visible field', () => {
        const document = state(
            [
                collection('fields', [property('first')], {
                    complete: false,
                    totalItems: 2,
                }),
            ],
            [owner('root', 'fields')]
        );
        expect(() => createMoveEdit(document, 'first', 'fields', null)).toThrow(
            'original field order for undo'
        );
    });

    it('rejects a member kind that the destination cannot contain', () => {
        const document = state(
            [collection('fields', [property('first')]), collection('attributes', [])],
            [
                {
                    id: 'xml',
                    kind: 'xmlComplex',
                    attributes: { id: 'attributes', totalItems: 0 },
                    particleNodeId: null,
                    mixed: false,
                },
            ]
        );
        expect(() => createMoveEdit(document, 'first', 'attributes', null)).toThrow(
            'cannot contain that kind of field'
        );
    });

    it('distinguishes a known descendant from an incompletely loaded branch', () => {
        const parent = {
            ...property('parent', 'child'),
            valueSummary: {
                ...property('parent', 'child').valueSummary,
                kind: 'object' as const,
            },
        };
        const document = state(
            [
                collection('root-fields', [parent]),
                collection('child-fields', []),
                collection('target', []),
            ],
            [owner('child', 'child-fields'), owner('target-node', 'target')]
        );
        expect(() => createMoveEdit(document, 'parent', 'child-fields', null)).toThrow(
            'own descendants'
        );
        const incomplete = state(
            [...document.collections.values()].map(value =>
                value.collectionId === 'child-fields'
                    ? { ...value, complete: false }
                    : value
            ),
            [...document.nodes.values()]
        );
        expect(() => createMoveEdit(incomplete, 'parent', 'target', null)).toThrow(
            'ancestry can be checked'
        );
    });
});
