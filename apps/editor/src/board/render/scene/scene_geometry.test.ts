import { expect, it } from 'vitest';
import type { BoardCard, BoardModel } from '../../model';
import { SceneGeometry } from './scene_geometry';

function fixture(): BoardModel {
    const source: BoardCard = {
        blockId: 'source',
        nodeId: 'source-node',
        collectionId: 'source-members',
        title: 'source',
        position: { x: 0, y: 0 },
        pinned: false,
        collapsed: false,
        suggested: false,
        rows: Array.from({ length: 20 }, (_, index) => ({
            memberId: `member-${index}`,
            name: `field${index}`,
            typeLabel: 'string',
            icon: 'element',
            change: 'unchanged',
            expandable: index === 15,
            expanded: index === 15,
        })),
        rowWindow: {
            firstMemberId: 'member-0',
            totalItems: 20,
            state: 'complete',
            hasMore: false,
        },
    };
    const child: BoardCard = {
        ...source,
        blockId: 'child',
        nodeId: 'child-node',
        title: 'child',
        position: { x: 400, y: 0 },
        rows: [],
        rowWindow: {
            firstMemberId: null,
            totalItems: 0,
            state: 'complete',
            hasMore: false,
        },
    };

    return {
        version: 1,
        state: 'ready',
        selection: null,
        cards: [source, child],
        connections: [
            {
                id: 'nested',
                sourceBlockId: 'source',
                sourceMemberId: 'member-15',
                targetBlockId: 'child',
                kind: 'containment',
                state: 'normal',
            },
        ],
    };
}

it('keeps loaded row scrolling and row connection anchors together without a camera or document mutation', () => {
    const model = fixture();
    let invalidations = 0;
    const scene = new SceneGeometry(
        text => text.length * 8,
        () => (invalidations += 1)
    );
    scene.rebuild(model, 'working');
    expect(scene.getGeometry().cards[0].rows).toHaveLength(10);
    expect(scene.getGeometry().connections[0].sourceHidden).toBe(true);
    expect(scene.scrollRows('source', 280)).toBe(true);
    const scrolled = scene.getGeometry();
    expect(scrolled.cards[0].rows.map(row => row.memberId)).toEqual(
        Array.from({ length: 10 }, (_, index) => `member-${index + 10}`)
    );
    expect(scrolled.connections[0].sourceHidden).toBe(false);
    expect(scrolled.connections[0].source).toEqual({ x: 248, y: 192 });
    expect(scene.hitTest({ x: 20, y: 192 })).toEqual({
        kind: 'row',
        blockId: 'source',
        memberId: 'member-15',
    });
    expect(model.cards[0].rows[0].memberId).toBe('member-0');
    expect(invalidations).toBe(1);
});

it('retains stable row anchors across model revisions and releases the spatial working set', () => {
    const model = fixture();
    const scene = new SceneGeometry(
        text => text.length * 8,
        () => undefined
    );
    scene.rebuild(model, 'working');
    scene.revealMember('source', 'member-15');
    const version = {
        ...model,
        version: 2,
        selection: { blockId: 'source', memberId: 'member-15' },
    };
    scene.setModel(version);
    scene.scrollRows('source', 28);
    expect(scene.getGeometry().version).toBe(2);
    expect(scene.getGeometry().cards[0].rows[0].memberId).toBe('member-7');
    scene.clear();
    expect(scene.queryCards({ x: 0, y: 0, width: 800, height: 600 })).toEqual([]);
    expect(scene.getGeometry().cards).toEqual([]);
    expect(scene.getGeometry().connections).toEqual([]);
});
