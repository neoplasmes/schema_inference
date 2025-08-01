import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCardGeometry } from '../../layout';
import type {
    BoardCard,
    BoardEventMap,
    BoardModel,
    BoardViewport,
    Point,
} from '../../model';
import type { BoardGeometry, BoardRenderer, Rectangle } from '../../render/contracts';
import { screenToWorld } from '../../viewport';
import { createBoardInteraction } from './create_board_interaction';

class ElementStub extends EventTarget {
    style: Record<string, string> = {
        touchAction: '',
        outline: '',
        outlineOffset: '',
        cursor: '',
    };
    attributes = new Map<string, string>();
    dataset: Record<string, string> = {};
    children: ElementStub[] = [];
    parent: ElementStub | null = null;
    captured = new Set<number>();
    clientWidth = 800;
    clientHeight = 600;
    tabIndex = -1;
    type = '';
    value = '';
    selected = false;

    constructor(readonly ownerDocument: DocumentStub) {
        super();
    }

    getAttribute(name: string) {
        return this.attributes.get(name) ?? null;
    }
    setAttribute(name: string, value: string) {
        this.attributes.set(name, value);
    }
    removeAttribute(name: string) {
        this.attributes.delete(name);
    }
    getBoundingClientRect() {
        return { left: 100, top: 50, width: 800, height: 600 };
    }
    querySelector(selector: string) {
        return selector === '[data-board-rename]'
            ? (this.children.find(child => child.dataset.boardRename) ?? null)
            : null;
    }
    append(child: ElementStub) {
        this.children.push(child);
        child.parent = this;
    }
    remove() {
        if (this.parent) {
            this.parent.children = this.parent.children.filter(child => child !== this);
        }
    }
    contains(child: ElementStub): boolean {
        return (
            child === this || this.children.some(candidate => candidate.contains(child))
        );
    }
    focus() {
        this.ownerDocument.activeElement = this;
        this.dispatchEvent(new Event('focus'));
    }
    select() {
        this.selected = true;
    }
    setPointerCapture(id: number) {
        this.captured.add(id);
    }
    hasPointerCapture(id: number) {
        return this.captured.has(id);
    }
    releasePointerCapture(id: number) {
        this.captured.delete(id);
    }
}

class DocumentStub {
    defaultView = new EventTarget();
    activeElement: ElementStub | null = null;
    createElement() {
        return new ElementStub(this);
    }
}

function event(target: EventTarget, type: string, fields: Record<string, unknown> = {}) {
    const value = new Event(type, { cancelable: true });
    Object.assign(value, fields);
    target.dispatchEvent(value);

    return value;
}

function inside(point: Point, rect: Rectangle) {
    return (
        point.x >= rect.x &&
        point.x <= rect.x + rect.width &&
        point.y >= rect.y &&
        point.y <= rect.y + rect.height
    );
}

function card(blockId: string, x: number): BoardCard {
    return {
        blockId,
        nodeId: `node-${blockId}`,
        collectionId: `collection-${blockId}`,
        title: blockId,
        position: { x, y: 0 },
        pinned: false,
        collapsed: false,
        suggested: false,
        rows: [
            {
                memberId: `${blockId}-one`,
                name: 'one',
                typeLabel: 'string',
                icon: 'element',
                change: 'unchanged',
                expandable: true,
                expanded: false,
            },
            {
                memberId: `${blockId}-two`,
                name: 'two',
                typeLabel: 'string',
                icon: 'element',
                change: 'unchanged',
                expandable: false,
                expanded: false,
            },
        ],
        rowWindow: {
            firstMemberId: `${blockId}-one`,
            totalItems: 2,
            hasMore: false,
            state: 'complete',
        },
    };
}

function setup(initialViewport: BoardViewport = { x: 0, y: 0, zoom: 1 }) {
    const document = new DocumentStub();
    const container = new ElementStub(document);
    let model: BoardModel = {
        version: 1,
        state: 'ready',
        cards: [card('a', 0), card('b', 320)],
        connections: [],
        selection: null,
    };
    let viewport = initialViewport;
    let geometry: BoardGeometry;
    const rebuild = () => {
        geometry = {
            version: model.version,
            cards: model.cards.map(card =>
                createCardGeometry(card, card.position!, 'working')
            ),
            connections: [],
            bounds: { x: 0, y: 0, width: 600, height: 100 },
        };
    };
    rebuild();
    const renderer: BoardRenderer = {
        ready: Promise.resolve(),
        setModel: vi.fn(),
        setHover: vi.fn(),
        setViewport: vi.fn(),
        resize: vi.fn(),
        invalidate: vi.fn(),
        destroy: vi.fn(),
        getGeometry: () => geometry,
        hitTest: vi.fn(point => {
            for (const card of [...geometry.cards].reverse()) {
                const region = [...card.regions]
                    .reverse()
                    .find(region => inside(point, region.bounds));

                if (region) {
                    return region.target;
                }
            }

            return null;
        }),
        queryCards: rect => geometry.cards.filter(card => inside(rect, card.bounds)),
        previewCardPosition: vi.fn(),
        setDropTarget: vi.fn(),
        scrollRows: vi.fn(() => false),
        revealMember: vi.fn(() => false),
        previewMemberDrag: vi.fn(),
        getStats: () => ({
            renderedFrames: 0,
            visibleCards: 2,
            visibleConnections: 0,
            textObjects: 0,
            lod: 'working',
        }),
    };
    const emitted: {
        type: keyof BoardEventMap;
        payload: BoardEventMap[keyof BoardEventMap];
    }[] = [];
    const interaction = createBoardInteraction({
        container: container as unknown as HTMLElement,
        renderer,
        getModel: () => model,
        getViewport: () => viewport,
        setViewport: next => {
            viewport = next;
        },
        emit: (type, payload) => {
            emitted.push({ type, payload });
        },
    });
    const pointer = (type: string, x: number, y: number, id = 1, button = 0) =>
        event(container, type, {
            clientX: x + 100,
            clientY: y + 50,
            pointerId: id,
            button,
        });
    const key = (key: string, fields: Record<string, unknown> = {}) =>
        event(container, 'keydown', { key, ...fields });
    const events = (type: keyof BoardEventMap) =>
        emitted.filter(entry => entry.type === type).map(entry => entry.payload);

    return {
        document,
        container,
        renderer,
        interaction,
        pointer,
        key,
        events,
        get viewport() {
            return viewport;
        },
        setViewport(next: BoardViewport) {
            viewport = next;
            interaction.viewportChanged();
        },
        setModel(next: BoardModel) {
            model = next;
            rebuild();
            interaction.modelChanged();
        },
        get model() {
            return model;
        },
    };
}

afterEach(() => {
    vi.useRealTimers();
});

describe('board interaction', () => {
    it.each([0.25, 1, 2.5])(
        'selects the same stable row through the shared transform at zoom %s',
        zoom => {
            const board = setup({ x: 24, y: 18, zoom });
            board.pointer('pointerdown', 20 * zoom + 24, 50 * zoom + 18);
            board.pointer('pointerup', 20 * zoom + 24, 50 * zoom + 18);
            expect(board.events('select')).toEqual([{ blockId: 'a', memberId: 'a-one' }]);
            board.interaction.destroy();
        }
    );

    it('anchors wheel zoom to the cursor, clamps it, and batches viewport events', () => {
        vi.useFakeTimers();
        const board = setup({ x: 30, y: 20, zoom: 0.8 });
        const anchor = { x: 160, y: 100 };
        const before = screenToWorld(anchor, board.viewport);
        event(board.container, 'wheel', {
            clientX: 260,
            clientY: 150,
            deltaX: 0,
            deltaY: -10000,
            deltaMode: 0,
            ctrlKey: true,
        });
        expect(board.viewport.zoom).toBe(3);
        expect(screenToWorld(anchor, board.viewport)).toEqual(before);
        expect(board.events('viewportChange')).toEqual([]);
        vi.advanceTimersByTime(120);
        expect(board.events('viewportChange')).toHaveLength(1);
        event(board.container, 'wheel', {
            clientX: 260,
            clientY: 150,
            deltaX: 0,
            deltaY: 10000,
            deltaMode: 0,
            ctrlKey: true,
        });
        expect(board.viewport.zoom).toBe(0.12);
        board.interaction.destroy();
    });

    it('pans with trackpad deltas and normalizes line units', () => {
        const board = setup();
        event(board.container, 'wheel', {
            clientX: 600,
            clientY: 350,
            deltaX: 2,
            deltaY: 3,
            deltaMode: 1,
        });
        expect(board.viewport).toEqual({ x: -32, y: -48, zoom: 1 });
        board.interaction.destroy();
    });

    it('scrolls a bounded card locally while preserving the camera and semantic state', () => {
        const board = setup();
        vi.mocked(board.renderer.scrollRows).mockReturnValue(true);
        event(board.container, 'wheel', {
            clientX: 140,
            clientY: 100,
            deltaX: 0,
            deltaY: 84,
            deltaMode: 0,
        });
        expect(board.renderer.scrollRows).toHaveBeenCalledWith('a', 84);
        expect(board.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
        expect(board.events('move')).toEqual([]);
        expect(board.events('viewportChange')).toEqual([]);
        event(board.container, 'wheel', {
            clientX: 140,
            clientY: 100,
            deltaX: 0,
            deltaY: -10,
            deltaMode: 0,
            ctrlKey: true,
        });
        expect(board.viewport.zoom).toBeGreaterThan(1);
        board.interaction.destroy();
    });

    it('reveals the stable linked member when its boundary indicator is activated', () => {
        const board = setup();
        vi.mocked(board.renderer.hitTest).mockReturnValue({
            kind: 'boundary',
            blockId: 'a',
            memberId: 'a-two',
        });
        board.pointer('pointerdown', 20, 50);
        board.pointer('pointerup', 20, 50);
        expect(board.renderer.revealMember).toHaveBeenCalledWith('a', 'a-two');
        expect(board.events('select')).toEqual([{ blockId: 'a', memberId: 'a-two' }]);
        expect(board.events('move')).toEqual([]);
        expect(board.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
        board.interaction.destroy();
    });

    it('uses all loaded rows for keyboard navigation across a local window boundary', () => {
        const board = setup();
        const source = board.model.cards[0];
        const rows = Array.from({ length: 50 }, (_, index) => ({
            ...source.rows[1],
            memberId: `row-${index}`,
            name: `row ${index}`,
        }));
        board.setModel({
            ...board.model,
            cards: [
                {
                    ...source,
                    rows,
                    rowWindow: {
                        firstMemberId: 'row-0',
                        totalItems: 50,
                        state: 'complete',
                        hasMore: false,
                    },
                },
            ],
            selection: { blockId: 'a', memberId: 'row-9' },
        });
        board.key('ArrowDown');
        expect(board.events('select').at(-1)).toEqual({
            blockId: 'a',
            memberId: 'row-10',
        });
        expect(board.renderer.revealMember).toHaveBeenCalledWith('a', 'row-10');
        expect(board.events('move')).toEqual([]);
        board.interaction.destroy();
    });

    it('keeps card movement as a preview and commits once without a click', () => {
        const board = setup({ x: 0, y: 0, zoom: 2 });
        board.pointer('pointerdown', 40, 30);
        board.pointer('pointermove', 80, 90);
        board.pointer('pointermove', 100, 110);
        expect(board.events('move')).toEqual([]);
        expect(board.renderer.previewCardPosition).toHaveBeenLastCalledWith('a', {
            x: 30,
            y: 40,
        });
        board.pointer('pointerup', 100, 110);
        board.pointer('pointerup', 100, 110);
        expect(board.events('move')).toEqual([
            { kind: 'card', blockId: 'a', position: { x: 30, y: 40 } },
        ]);
        expect(board.events('select')).toEqual([]);
        expect(board.renderer.previewCardPosition).toHaveBeenLastCalledWith('a', null);
        expect(board.container.captured.size).toBe(0);
        board.interaction.destroy();
    });

    it('cancels card and pan gestures without semantic commits', () => {
        const board = setup();
        board.pointer('pointerdown', 20, 20);
        board.pointer('pointermove', 100, 100);
        board.pointer('pointercancel', 100, 100);
        expect(board.renderer.previewCardPosition).toHaveBeenLastCalledWith('a', null);
        expect(board.events('move')).toEqual([]);
        board.pointer('pointerdown', 700, 500);
        board.pointer('pointermove', 750, 550);
        expect(board.viewport.x).toBe(50);
        board.key('Escape');
        expect(board.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
        expect(board.events('viewportChange')).toEqual([]);
        board.interaction.destroy();
    });

    it('commits member transfer using collection and before-member IDs', () => {
        const board = setup();
        board.pointer('pointerdown', 20, 50);
        board.pointer('pointermove', 340, 74);
        expect(board.events('move')).toEqual([]);
        board.pointer('pointerup', 340, 74);
        expect(board.events('move')).toEqual([
            {
                kind: 'member',
                memberId: 'a-one',
                sourceBlockId: 'a',
                targetBlockId: 'b',
                targetCollectionId: 'collection-b',
                beforeMemberId: 'b-two',
            },
        ]);
        expect(board.renderer.setDropTarget).toHaveBeenLastCalledWith(null);
        board.interaction.destroy();
    });

    it('allows a loaded headerless summary collection to receive a member drop', () => {
        const board = setup();
        board.setModel({
            ...board.model,
            cards: board.model.cards.map(card =>
                card.blockId === 'b' ? { ...card, display: 'summary' } : card
            ),
        });
        board.pointer('pointerdown', 20, 50);
        board.pointer('pointermove', 340, 42);
        board.pointer('pointerup', 340, 42);
        expect(board.events('move')).toEqual([
            {
                kind: 'member',
                memberId: 'a-one',
                sourceBlockId: 'a',
                targetBlockId: 'b',
                targetCollectionId: 'collection-b',
                beforeMemberId: 'b-two',
            },
        ]);
        board.interaction.destroy();
    });

    it('rejects incompatible collection transfers and descendant cycles', () => {
        const board = setup();
        board.setModel({
            ...board.model,
            cards: board.model.cards.map(card =>
                card.blockId === 'b'
                    ? {
                          ...card,
                          rows: card.rows.map(row => ({ ...row, icon: 'attribute' })),
                      }
                    : card
            ),
        });
        board.pointer('pointerdown', 20, 50);
        board.pointer('pointermove', 340, 74);
        board.pointer('pointerup', 340, 74);
        expect(board.events('move')).toEqual([]);
        board.setModel({
            ...board.model,
            cards: [card('a', 0), card('b', 320)],
            connections: [
                {
                    id: 'edge',
                    sourceBlockId: 'a',
                    sourceMemberId: 'a-one',
                    targetBlockId: 'b',
                    kind: 'containment',
                    state: 'normal',
                },
            ],
        });
        board.pointer('pointerdown', 20, 50);
        board.pointer('pointermove', 340, 74);
        board.pointer('pointerup', 340, 74);
        expect(board.events('move')).toEqual([]);
        board.interaction.destroy();
    });

    it('uses specific expand, variant and loading targets', () => {
        const board = setup();
        board.pointer('pointerdown', 235, 50);
        board.pointer('pointerup', 235, 50);
        expect(board.events('expand')).toEqual([
            { blockId: 'a', memberId: 'a-one', expanded: true },
        ]);
        board.setModel({
            ...board.model,
            cards: [
                {
                    ...card('a', 0),
                    variants: [
                        { variantId: 'v', scopeId: 's', title: 'V', count: 1, total: 2 },
                    ],
                    rowWindow: {
                        firstMemberId: 'a-one',
                        totalItems: 3,
                        hasMore: true,
                        state: 'partial',
                    },
                },
            ],
        });
        board.pointer('pointerdown', 20, 45);
        board.pointer('pointerup', 20, 45);
        expect(board.events('variantChange')).toEqual([
            { blockId: 'a', variantId: 'v', scopeId: 's' },
        ]);
        const more = board.renderer
            .getGeometry()
            .cards[0].regions.find(region => region.target.kind === 'more')!.bounds;
        board.pointer('pointerdown', more.x + more.width / 2, more.y + more.height / 2);
        board.pointer('pointerup', more.x + more.width / 2, more.y + more.height / 2);
        expect(board.events('loadMore')).toEqual([
            { blockId: 'a', collectionId: 'collection-a' },
        ]);
        board.interaction.destroy();
    });

    it('deduplicates hover and clears it when leaving', () => {
        const board = setup();
        board.pointer('pointermove', 20, 50);
        board.pointer('pointermove', 30, 52);
        event(board.container, 'pointerleave');
        expect(board.events('hover')).toEqual([
            { blockId: 'a', memberId: 'a-one' },
            null,
        ]);
        expect(board.renderer.setHover).toHaveBeenCalledTimes(2);
        board.interaction.destroy();
    });

    it('pinches around the original world anchor and emits once after release', () => {
        const board = setup();
        board.pointer('pointerdown', 500, 400, 1);
        board.pointer('pointerdown', 600, 400, 2);
        board.pointer('pointermove', 700, 400, 2);
        expect(board.viewport).toEqual({ x: -500, y: -400, zoom: 2 });
        expect(screenToWorld({ x: 600, y: 400 }, board.viewport)).toEqual({
            x: 550,
            y: 400,
        });
        expect(board.events('viewportChange')).toEqual([]);
        board.pointer('pointerup', 700, 400, 2);
        board.pointer('pointerup', 500, 400, 1);
        expect(board.events('viewportChange')).toHaveLength(1);
        expect(board.events('select')).toEqual([]);
        board.interaction.destroy();
    });

    it('navigates stable cards and rows, expands, and permits Tab to leave the board', () => {
        const board = setup();
        board.key('ArrowDown');
        board.key('ArrowDown');
        board.key('ArrowRight');
        expect(board.events('select').slice(0, 2)).toEqual([
            { blockId: 'a', memberId: null },
            { blockId: 'a', memberId: 'a-one' },
        ]);
        expect(board.events('expand')).toEqual([
            { blockId: 'a', memberId: 'a-one', expanded: true },
        ]);
        board.key('End');
        expect(board.key('Tab').defaultPrevented).toBe(false);
        expect(board.container.style.outline).toContain('solid');
        board.interaction.destroy();
    });

    it('renames with Enter, protects IME composition, and cancels Escape', () => {
        const board = setup();
        board.key('ArrowDown');
        board.key('ArrowDown');
        board.key('F2');
        const input = board.container.children[0];
        expect(input.selected).toBe(true);
        expect(input.value).toBe('one');
        input.value = 'renamed';
        event(input, 'compositionstart');
        event(input, 'keydown', { key: 'Enter', isComposing: true });
        expect(board.events('rename')).toEqual([]);
        expect(board.container.children).toHaveLength(1);
        event(input, 'compositionend');
        event(input, 'keydown', { key: 'Enter' });
        expect(board.events('rename')).toEqual([
            { blockId: 'a', memberId: 'a-one', name: 'renamed' },
        ]);
        expect(board.container.children).toHaveLength(0);
        expect(board.document.activeElement).toBe(board.container);
        board.key('F2');
        const canceled = board.container.children[0];
        canceled.value = 'discard';
        event(canceled, 'keydown', { key: 'Escape' });
        expect(board.events('rename')).toHaveLength(1);
        expect(board.container.children).toHaveLength(0);
        board.interaction.destroy();
    });

    it('removes overlays, captures, timers and listeners on repeated destroy', () => {
        vi.useFakeTimers();
        const board = setup();
        board.key('ArrowDown');
        board.key('ArrowDown');
        board.key('F2');
        event(board.container, 'wheel', {
            clientX: 700,
            clientY: 500,
            deltaX: 1,
            deltaY: 2,
            deltaMode: 0,
        });
        const viewportEvents = board.events('viewportChange').length;
        board.interaction.destroy();
        board.interaction.destroy();
        const calls = vi.mocked(board.renderer.hitTest).mock.calls.length;
        board.pointer('pointerdown', 20, 50);
        board.pointer('pointerup', 20, 50);
        vi.runAllTimers();
        expect(board.container.children).toHaveLength(0);
        expect(board.container.captured.size).toBe(0);
        expect(board.events('viewportChange')).toHaveLength(viewportEvents);
        expect(board.events('rename')).toEqual([]);
        expect(board.renderer.hitTest).toHaveBeenCalledTimes(calls);
    });

    it('cancels active gestures and native input when the window loses focus', () => {
        const board = setup();
        board.pointer('pointerdown', 700, 500);
        board.pointer('pointermove', 750, 550);
        event(board.document.defaultView, 'blur');
        expect(board.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
        expect(board.container.captured.size).toBe(0);
        board.key('ArrowDown');
        board.key('ArrowDown');
        board.key('F2');
        event(board.document.defaultView, 'blur');
        expect(board.container.children).toHaveLength(0);
        expect(board.events('rename')).toEqual([]);
        board.interaction.destroy();
    });

    it('accepts complete empty target collections for document-level validation', () => {
        const board = setup();
        board.setModel({
            ...board.model,
            cards: [
                card('a', 0),
                {
                    ...card('b', 320),
                    rows: [],
                    rowWindow: {
                        firstMemberId: null,
                        totalItems: 0,
                        hasMore: false,
                        state: 'complete',
                    },
                },
            ],
        });
        board.pointer('pointerdown', 20, 50);
        board.pointer('pointermove', 340, 20);
        board.pointer('pointerup', 340, 20);
        expect(board.events('move')).toEqual([
            {
                kind: 'member',
                memberId: 'a-one',
                sourceBlockId: 'a',
                targetBlockId: 'b',
                targetCollectionId: 'collection-b',
                beforeMemberId: null,
            },
        ]);
        board.interaction.destroy();
    });

    it('positions the single rename input from row geometry and closes it when the row disappears', () => {
        const board = setup();
        board.key('ArrowDown');
        board.key('ArrowDown');
        board.key('F2');
        const input = board.container.children[0];
        board.setViewport({ x: 50, y: 20, zoom: 2 });
        expect(input.style.left).toBe('106px');
        expect(input.style.top).toBe('104px');
        expect(input.style.height).toBe('20px');
        expect(Number.parseFloat(input.style.width)).toBeLessThan(240);
        expect(input.style.outline).toBe('none');
        expect(input.style.transform).toBe('scale(2)');
        board.setModel({ ...board.model, cards: [] });
        expect(board.container.children).toHaveLength(0);
        expect(board.events('rename')).toEqual([]);
        board.interaction.destroy();
    });

    it('keeps board instances isolated across input, camera and disposal', () => {
        const first = setup();
        const second = setup();
        first.pointer('pointerdown', 700, 500);
        first.pointer('pointermove', 750, 550);
        first.pointer('pointerup', 750, 550);
        first.key('ArrowDown');
        first.key('ArrowDown');
        first.key('F2');
        expect(second.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
        expect(second.events('select')).toEqual([]);
        expect(second.container.children).toHaveLength(0);
        first.interaction.destroy();
        second.pointer('pointerdown', 20, 50);
        second.pointer('pointerup', 20, 50);
        expect(second.events('select')).toEqual([{ blockId: 'a', memberId: 'a-one' }]);
        second.interaction.destroy();
    });
});
