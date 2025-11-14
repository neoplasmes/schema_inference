import { describe, expect, it } from 'vitest';
import { getScene } from '../../../../../../playground';
import { createCardGeometry, needsFooter } from '../../../../../board/layout';
import { fixtureDocument } from '../fixture';
import { initialView, projectDocument } from '.';

function setup() {
    const template = getScene('main').board;
    const { document } = fixtureDocument(template);
    const view = initialView(template);
    const project = () => projectDocument(document, view, template, 1);

    return {
        document,
        view,
        project,
        template,
    };
}

describe('semantic document presentation', () => {
    it('preserves fixture geometry and collection states without changing the source scene', () => {
        const { document, project, template } = setup();
        const model = project();

        expect(model.cards.map(card => card.position)).toEqual(
            template.cards.map(card => card.position)
        );
        expect(model.cards.map(card => card.rows.map(row => row.name))).toEqual(
            template.cards.map(card => card.rows.map(row => row.name))
        );
        expect(model.cards.map(card => card.rowWindow)).toMatchObject(
            template.cards.map(card => card.rowWindow)
        );
        expect(document.operations).toEqual([]);
    });

    it('keeps a complete main order card at its reference height without a footer', () => {
        const { project } = setup();
        const order = project().cards.find(card => card.blockId === 'order')!;

        expect(order.rowWindow.loadedItems).toBeUndefined();
        expect(order.rowWindow.firstIndex).toBeUndefined();
        expect(needsFooter(order)).toBe(false);
        expect(createCardGeometry(order, order.position!, 'working').bounds).toEqual({
            x: 300,
            y: 110,
            width: 248,
            height: 182,
        });
    });

    it('counts attributes and particles together when a card needs a partial footer', () => {
        const { document, project } = setup();
        const particles = document.collections.get('members-order')!;
        document.addPage({
            ...particles,
            snapshot: document.manifest.snapshot,
            scopeId: null,
            nextCursor: '4',
        });
        const order = project().cards.find(card => card.blockId === 'order')!;

        expect(order.rowWindow.loadedItems).toBe(5);
        expect(order.rowWindow.totalItems).toBe(5);
    });

    it('targets an unfinished attribute collection when particle loading has completed', () => {
        const { document, project } = setup();
        const attributes = document.collections.get('members-order/attributes')!;
        document.addPage({
            ...attributes,
            snapshot: document.manifest.snapshot,
            scopeId: null,
            totalItems: 51,
            nextCursor: 'next-attributes',
        });
        const order = project().cards.find(card => card.blockId === 'order')!;

        expect(order.collectionId).toBe('members-order/attributes');
        expect(order.rowWindow.state).toBe('partial');
        expect(order.rowWindow.loadedItems).toBe(5);
        expect(order.rowWindow.hasMore).toBe(true);
    });

    it('projects field transfer, undo and redo through loaded document collections', () => {
        const { document, project } = setup();
        document.move('name', 'members-payment', 'amount');
        expect(
            project()
                .cards.find(card => card.blockId === 'customer')
                ?.rows.some(row => row.memberId === 'name')
        ).toBe(false);
        expect(
            project().cards.find(card => card.blockId === 'payment')?.rows[0].memberId
        ).toBe('name');
        document.undo();
        expect(
            project().cards.find(card => card.blockId === 'customer')?.rows[0].memberId
        ).toBe('name');
        document.redo();
        expect(
            project().cards.find(card => card.blockId === 'payment')?.rows[0].memberId
        ).toBe('name');
    });

    it('retains an element rename after committing the local demo base', () => {
        const { document, project } = setup();
        document.rename('customer', 'buyer');
        expect(project().cards.find(card => card.blockId === 'customer')?.title).toBe(
            'buyer'
        );
        document.beginSave('local-save');
        document.confirmSave('local-revision', 'local-save');
        expect(project().cards.find(card => card.blockId === 'customer')?.title).toBe(
            'buyer'
        );
        expect(
            project()
                .cards.find(card => card.blockId === 'order')
                ?.rows.find(row => row.memberId === 'customer')?.name
        ).toBe('buyer');
        document.undo();
        expect(project().cards.find(card => card.blockId === 'customer')?.title).toBe(
            'customer'
        );
    });

    it('keeps expansion, variant and pinned positions out of semantic operations', () => {
        const { document, view, project } = setup();
        view.positions.set('order', {
            x: 500,
            y: 400,
        });
        view.expanded.set('order/customer', false);
        view.variants.set('payment', 'invoice');
        const model = project();
        expect(model.cards.find(card => card.blockId === 'order')?.position).toEqual({
            x: 500,
            y: 400,
        });
        expect(model.cards.some(card => card.blockId === 'customer')).toBe(false);
        expect(
            model.cards.find(card => card.blockId === 'payment')?.activeVariantId
        ).toBe('invoice');
        expect(document.operations).toEqual([]);
    });
});

it('switches the observed structural variant without changing the manual document', async () => {
    const { document, project, view, template } = setup();
    const { projectEvidence } = await import('../evidence');
    const before = project();
    view.variants.set('payment', 'invoice');
    const preview = projectEvidence(project(), view, template);
    expect(
        preview.cards.find(card => card.blockId === 'payment')?.rows.map(row => row.name)
    ).toContain('inn');
    expect(preview.cards.some(card => card.blockId === 'observed-bank')).toBe(true);
    expect(document.operations).toEqual([]);
    view.variants.set('payment', 'card');
    expect(
        projectEvidence(project(), view, template).cards.map(card =>
            card.rows.map(row => row.name)
        )
    ).toEqual(before.cards.map(card => card.rows.map(row => row.name)));
});

it('creates separate fixture snapshots and clean local documents for each resource opening', () => {
    const model = getScene('main').board;
    const firstSnapshot = {
        resource: 'schema' as const,
        id: 'resource-a',
        revision: 'revision-a',
    };
    const secondSnapshot = {
        resource: 'schema' as const,
        id: 'resource-b',
        revision: 'revision-b',
    };
    const first = fixtureDocument(model, firstSnapshot);
    first.document.rename('id', 'editedId');
    const second = fixtureDocument(model, secondSnapshot);
    const reopened = fixtureDocument(model, firstSnapshot);

    expect(first.document.operations).toHaveLength(1);
    expect(second.document.operations).toEqual([]);
    expect(reopened.document.operations).toEqual([]);
    expect(second.document.manifest.snapshot).toEqual(secondSnapshot);
    expect(
        [
            ...second.fixture.pages.values(),
        ].every(page => page.snapshot === secondSnapshot)
    ).toBe(true);
    expect(
        second.document.collections.get('members-order/attributes')?.items[0].member
    ).toMatchObject({
        name: {
            localName: 'id',
        },
    });
    expect(
        reopened.document.collections.get('members-order/attributes')?.items[0].member
    ).toMatchObject({
        name: {
            localName: 'id',
        },
    });
    expect(reopened.document).not.toBe(first.document);
});
