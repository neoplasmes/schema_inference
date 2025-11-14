import { describe, expect, it } from 'vitest';
import type { BoardCard, BoardConnection, BoardModel } from '../model';
import {
    cardSize,
    cardMetrics,
    rowScrollbar,
    connectionGeometry,
    createCardGeometry,
    hiddenSourceMembers,
} from './card_geometry';
import { layoutCards } from './tree_layout';
import { intersects, SpatialIndex } from './spatial_index';
import { hitTestCards } from './hit_test';
import { showSeparator } from './row_states';
import { screenToWorld, worldToScreen } from '../viewport';

function card(
    blockId: string,
    names = [
        'one',
        'two',
    ]
): BoardCard {
    return {
        blockId,
        nodeId: 'shared-node',
        collectionId: `members:${blockId}`,
        title: blockId,
        pinned: false,
        collapsed: false,
        suggested: false,
        rows: names.map(memberId => ({
            memberId,
            name: memberId,
            typeLabel: 'string',
            icon: 'element',
            change: 'unchanged',
            expandable: memberId === 'one',
            expanded: false,
        })),
        rowWindow: {
            firstMemberId: names[0] ?? null,
            totalItems: names.length,
            state: 'complete',
            hasMore: false,
        },
    };
}

function edge(
    id: string,
    source: string,
    target: string,
    kind: BoardConnection['kind'] = 'containment'
): BoardConnection {
    return {
        id,
        sourceBlockId: source,
        sourceMemberId: 'one',
        targetBlockId: target,
        kind,
        state: 'normal',
    };
}

function model(
    cards: readonly BoardCard[],
    connections: readonly BoardConnection[] = []
): BoardModel {
    return {
        version: 1,
        state: 'ready',
        cards,
        connections,
        selection: null,
    };
}

describe('card geometry', () => {
    it('includes padding in the reference order card dimensions', () => {
        expect(
            cardSize(
                card('order', [
                    'a',
                    'b',
                    'c',
                    'd',
                    'e',
                ]),
                'working'
            )
        ).toEqual({
            width: 248,
            height: 182,
        });
    });

    it('keeps suggestions in the header and renders compact summary rows without a second header', () => {
        const payment = {
            ...card('payment', [
                'a',
                'b',
                'c',
                'd',
            ]),
            width: 268,
            suggested: true,
            variants: [
                {
                    variantId: 'card',
                    scopeId: 'payment',
                    title: 'Card',
                    count: 10,
                    total: 15,
                },
            ],
        };
        expect(cardSize(payment, 'working')).toEqual({
            width: 268,
            height: 201,
        });
        const summary = createCardGeometry(
            {
                ...card('summary', [
                    'one',
                ]),
                display: 'summary',
            },
            {
                x: 0,
                y: 0,
            },
            'working'
        );

        expect(summary.bounds.height).toBe(36);
        expect(summary.rows[0].bounds.y).toBe(4);
        expect(
            hitTestCards(
                [
                    summary,
                ],
                {
                    x: 45,
                    y: 18,
                }
            )
        ).toEqual({
            kind: 'row',
            blockId: 'summary',
            memberId: 'one',
        });
    });

    it('uses one geometry path for the enlarged anatomy and comparison presentations', () => {
        const anatomy = {
            ...card('product', [
                'sku',
                'title',
                'price',
                'weight',
                'tags',
            ]),
            width: 420,
            metrics: {
                header: 44,
                row: 36,
                boundary: 28,
                footer: 40,
                occurrenceColumn: true,
            },
            rowWindow: {
                firstMemberId: 'sku',
                state: 'partial' as const,
                totalItems: 412,
                hasMore: true,
            },
        };
        const geometry = createCardGeometry(
            anatomy,
            {
                x: 0,
                y: 0,
            },
            'detailed',
            [
                'attrs',
                'media',
            ]
        );

        expect(geometry.bounds.height).toBe(300);
        expect(geometry.header.height).toBe(44);
        expect(geometry.rows[0].bounds.y).toBe(76);
        expect(geometry.rows[0].bounds.height).toBe(36);
        const comparison = {
            ...card('payment', [
                'a',
                'b',
                'c',
                'd',
                'e',
                'f',
                'g',
            ]),
            metrics: {
                header: 40,
                row: 34,
            },
            variants: [
                {
                    variantId: 'card',
                    scopeId: 'payment',
                    title: 'Card',
                    count: 10,
                    total: 15,
                },
            ],
        };
        expect(cardSize(comparison, 'detailed').height).toBe(333);
    });

    it('keeps external branch affordances visible and interactive without changing the card width', () => {
        const source = card('a');
        const geometry = createCardGeometry(
            {
                ...source,
                rows: source.rows.map(row =>
                    row.memberId === 'one'
                        ? {
                              ...row,
                              branch: {
                                  totalItems: null,
                                  state: 'notRequested',
                              },
                          }
                        : row
                ),
            },
            {
                x: -300,
                y: 0,
            },
            'working'
        );
        const pill = geometry.branches![0].bounds;
        const index = new SpatialIndex<{
            bounds: typeof pill;
            geometry: typeof geometry;
        }>();
        index.set('a', {
            bounds: geometry.visibilityBounds!,
            geometry,
        });

        expect(geometry.bounds.width).toBe(248);
        expect(geometry.visibilityBounds!.width).toBeGreaterThan(geometry.bounds.width);
        expect(
            index.query({
                x: 0,
                y: 0,
                width: 100,
                height: 100,
            })
        ).toHaveLength(1);
        expect(
            hitTestCards(
                [
                    geometry,
                ],
                {
                    x: pill.x + 10,
                    y: pill.y + 14,
                }
            )
        ).toEqual({
            kind: 'expand',
            blockId: 'a',
            memberId: 'one',
        });
        expect(geometry.branches![0].totalItems).toBeNull();
        const summary = createCardGeometry(
            {
                ...source,
                display: 'summary',
                rows: [
                    {
                        ...source.rows[0],
                        branch: {
                            totalItems: 6,
                            state: 'notRequested',
                        },
                    },
                ],
            },
            {
                x: 0,
                y: 0,
            },
            'working'
        );
        expect(summary.branches).toHaveLength(1);
        expect(summary.bounds.height).toBe(36);
    });

    it('anchors a connection to member identity after reordering', () => {
        const original = createCardGeometry(
            card('a'),
            {
                x: 0,
                y: 0,
            },
            'working'
        );
        const reordered = createCardGeometry(
            card('a', [
                'two',
                'one',
            ]),
            {
                x: 0,
                y: 0,
            },
            'working'
        );
        const target = createCardGeometry(
            card('b'),
            {
                x: 400,
                y: 50,
            },
            'working'
        );
        const before = connectionGeometry('edge', 'one', original, target, 'working');
        const after = connectionGeometry('edge', 'one', reordered, target, 'working');

        expect(before.source.x).toBe(248);
        expect(after.source.y - before.source.y).toBe(28);
        expect(after.target).toEqual(before.target);
    });

    it('keeps hidden member IDs as explicit boundary targets', () => {
        const source = card('a', [
            'two',
        ]);
        const target = card('b');
        const hidden = hiddenSourceMembers(
            model(
                [
                    source,
                    target,
                ],
                [
                    edge('edge', 'a', 'b'),
                ]
            )
        );
        const geometry = createCardGeometry(
            source,
            {
                x: 0,
                y: 0,
            },
            'working',
            hidden.get('a')
        );
        const connection = connectionGeometry(
            'edge',
            'one',
            geometry,
            createCardGeometry(
                target,
                {
                    x: 400,
                    y: 0,
                },
                'working'
            ),
            'working'
        );

        expect(hidden.get('a')).toEqual([
            'one',
        ]);
        expect(connection.sourceHidden).toBe(true);
        expect(
            geometry.regions.some(
                region =>
                    region.target.kind === 'boundary' && region.target.memberId === 'one'
            )
        ).toBe(true);
        expect(connection.source.y).not.toBe(geometry.rows[0].bounds.y + 14);
    });

    it.each([
        0.2,
        0.35,
        1,
        1.2,
        2,
    ])('finds the same row through viewport conversion at zoom %s', zoom => {
        const geometry = createCardGeometry(
            card('a'),
            {
                x: 300,
                y: 110,
            },
            'working'
        );
        const viewport = {
            x: -67,
            y: 100,
            zoom,
        };
        const screen = worldToScreen(
            {
                x: 345,
                y: 160,
            },
            viewport
        );

        expect(
            hitTestCards(
                [
                    geometry,
                ],
                screenToWorld(screen, viewport)
            )
        ).toEqual({
            kind: 'row',
            blockId: 'a',
            memberId: 'one',
        });
    });

    it('prioritizes expand over the row and the topmost card over its sibling', () => {
        const a = createCardGeometry(
            card('a'),
            {
                x: 0,
                y: 0,
            },
            'working'
        );
        const b = createCardGeometry(
            card('b'),
            {
                x: 0,
                y: 0,
            },
            'working'
        );

        expect(
            hitTestCards(
                [
                    a,
                ],
                {
                    x: 236,
                    y: 50,
                }
            )
        ).toEqual({
            kind: 'expand',
            blockId: 'a',
            memberId: 'one',
        });
        expect(
            hitTestCards(
                [
                    a,
                    b,
                ],
                {
                    x: 40,
                    y: 50,
                }
            )
        ).toEqual({
            kind: 'row',
            blockId: 'b',
            memberId: 'one',
        });
        expect(
            hitTestCards(
                [
                    a,
                ],
                {
                    x: 1000,
                    y: 0,
                }
            )
        ).toBeNull();
    });

    it('creates no row regions in overview and preserves one visual node per blockId', () => {
        const a = createCardGeometry(
            card('a'),
            {
                x: 0,
                y: 0,
            },
            'overview'
        );
        const b = createCardGeometry(
            card('b'),
            {
                x: 300,
                y: 0,
            },
            'overview'
        );

        expect(a.rows).toEqual([]);
        expect(a.blockId).not.toBe(b.blockId);
        expect(a.regions).toHaveLength(1);
    });

    it('bounds a fifty-row card and keeps local windows independent of loaded pages', () => {
        const source = card(
            'wide',
            Array.from(
                {
                    length: 50,
                },
                (_, index) => `member-${index}`
            )
        );
        const top = createCardGeometry(
            source,
            {
                x: 30,
                y: 40,
            },
            'working'
        );
        const scrolled = createCardGeometry(
            source,
            {
                x: 30,
                y: 40,
            },
            'working',
            [],
            35
        );

        expect(top.rows).toHaveLength(10);
        expect(top.bounds.height).toBe(350);
        expect(scrolled.bounds).toEqual(top.bounds);
        expect(scrolled.rows.map(row => row.memberId)).toEqual(
            Array.from(
                {
                    length: 10,
                },
                (_, index) => `member-${index + 35}`
            )
        );
        expect(scrolled.rowViewport).toMatchObject({
            firstIndex: 35,
            endIndex: 45,
            totalItems: 50,
        });
        expect(source.rows).toHaveLength(50);
        expect(source.rowWindow).toMatchObject({
            totalItems: 50,
            state: 'complete',
            hasMore: false,
        });
    });

    it('keeps an off-window linked field address and restores its actual row anchor after reveal', () => {
        const source = card(
            'wide',
            Array.from(
                {
                    length: 50,
                },
                (_, index) => `member-${index}`
            )
        );
        const target = card('target');
        const connection = {
            ...edge('linked', 'wide', 'target'),
            sourceMemberId: 'member-42',
        };
        const document = model(
            [
                source,
                target,
            ],
            [
                connection,
            ]
        );
        const hidden = hiddenSourceMembers(
            document,
            new Map([
                [
                    'wide',
                    new Set(source.rows.slice(0, 10).map(row => row.memberId)),
                ],
            ])
        );
        const initial = createCardGeometry(
            source,
            {
                x: 0,
                y: 0,
            },
            'working',
            hidden.get('wide')
        );
        const boundary = initial.regions.find(
            region => region.target.kind === 'boundary'
        )!;
        expect(boundary.target).toEqual({
            kind: 'boundary',
            blockId: 'wide',
            memberId: 'member-42',
        });
        const revealed = createCardGeometry(
            source,
            {
                x: 0,
                y: 0,
            },
            'working',
            [],
            40
        );
        const anchored = connectionGeometry(
            'linked',
            'member-42',
            revealed,
            createCardGeometry(
                target,
                {
                    x: 400,
                    y: 0,
                },
                'working'
            ),
            'working'
        );
        const actualRow = revealed.rows.find(row => row.memberId === 'member-42')!;
        expect(anchored.sourceHidden).toBe(false);
        expect(anchored.source.y).toBe(actualRow.bounds.y + actualRow.bounds.height / 2);
    });

    it('keeps a skeleton stub compact and gives an empty collection a separate add intent', () => {
        const empty = card('empty', []);
        const loading = {
            ...empty,
            width: 120,
            rowWindow: {
                ...empty.rowWindow,
                totalItems: 6,
                state: 'loading' as const,
            },
        };
        expect(cardSize(loading, 'working')).toEqual({
            width: 120,
            height: 54,
        });
        const geometry = createCardGeometry(
            empty,
            {
                x: 0,
                y: 0,
            },
            'working'
        );
        expect(geometry.bounds.height).toBe(91);
        expect(
            hitTestCards(
                [
                    geometry,
                ],
                {
                    x: 40,
                    y: 78,
                }
            )
        ).toEqual({
            kind: 'add',
            blockId: 'empty',
            collectionId: 'members:empty',
        });
    });

    it('keeps separators and the reserved name column independent from type glyphs', () => {
        const source = {
            ...card('comparison'),
            metrics: {
                rowGlyphs: false,
                separators: true,
                reserveGlyphColumn: true,
            },
        };
        expect(cardMetrics(source, 'detailed')).toMatchObject({
            rowGlyphs: false,
            separators: true,
            reserveGlyphColumn: true,
        });
        expect(
            cardMetrics(
                {
                    ...source,
                    metrics: {
                        ...source.metrics,
                        separators: false,
                    },
                },
                'detailed'
            )
        ).toMatchObject({
            rowGlyphs: false,
            separators: false,
            reserveGlyphColumn: true,
        });
    });

    it('places an illustrative partial-window thumb within its loaded rows rather than the server total', () => {
        const source = {
            ...card(
                'anatomy',
                Array.from(
                    {
                        length: 7,
                    },
                    (_, index) => `row-${index}`
                )
            ),
            metrics: {
                rowLimit: 5,
                row: 36,
            },
            rowWindow: {
                firstMemberId: 'row-0',
                firstIndex: 2,
                loadedItems: 50,
                totalItems: 412,
                state: 'partial' as const,
                hasMore: true,
            },
        };
        const geometry = createCardGeometry(
            source,
            {
                x: 0,
                y: 0,
            },
            'detailed'
        );
        const scrollbar = rowScrollbar(source, geometry)!;
        expect(geometry.rows).toHaveLength(5);
        expect(scrollbar.thumbTop - scrollbar.trackTop).toBeCloseTo((158 * 2) / 45);
        expect(scrollbar.thumbTop).toBeGreaterThan(scrollbar.trackTop);
    });

    it('keeps a real retained page offset separate from the local scrollbar position', () => {
        const source = {
            ...card(
                'paged',
                Array.from(
                    {
                        length: 50,
                    },
                    (_, index) => `row-${index}`
                )
            ),
            rowWindow: {
                firstMemberId: 'row-0',
                firstIndex: 100,
                loadedItems: 50,
                totalItems: 2000,
                state: 'partial' as const,
                hasMore: true,
            },
        };
        const top = rowScrollbar(
            source,
            createCardGeometry(
                source,
                {
                    x: 0,
                    y: 0,
                },
                'working'
            )
        )!;
        const moved = rowScrollbar(
            source,
            createCardGeometry(
                source,
                {
                    x: 0,
                    y: 0,
                },
                'working',
                [],
                20
            )
        )!;
        expect(top.thumbTop).toBe(top.trackTop);
        expect(moved.thumbTop).toBeGreaterThan(top.thumbTop);
        expect(source.rowWindow.firstIndex).toBe(100);
        const completeSlice = {
            ...card('complete'),
            rowWindow: {
                firstMemberId: 'one',
                loadedItems: 14,
                totalItems: 14,
                state: 'complete' as const,
                hasMore: false,
            },
        };
        expect(
            rowScrollbar(
                completeSlice,
                createCardGeometry(
                    completeSlice,
                    {
                        x: 0,
                        y: 0,
                    },
                    'working'
                )
            )
        ).toBeNull();
    });

    it('retains loaded rows and offers Retry on a failed page instead of empty state', () => {
        const failed = {
            ...card('a'),
            rowWindow: {
                firstMemberId: 'one',
                totalItems: 412,
                state: 'failed' as const,
                hasMore: true,
            },
        };
        const geometry = createCardGeometry(
            failed,
            {
                x: 0,
                y: 0,
            },
            'working'
        );

        expect(geometry.rows).toHaveLength(2);
        expect(geometry.regions.some(region => region.target.kind === 'more')).toBe(true);
        expect(geometry.bounds.height).toBe(126);
    });
});

describe('deterministic loaded-fragment layout', () => {
    it('has no overlap and preserves pinned coordinates', () => {
        const pinned = {
            ...card('pinned'),
            pinned: true,
            position: {
                x: 300,
                y: 110,
            },
        };
        const document = model([
            pinned,
            ...Array.from(
                {
                    length: 100,
                },
                (_, index) => card(`card-${index}`)
            ),
        ]);
        const positions = layoutCards(document, 'working');
        const geometry = document.cards.map(card =>
            createCardGeometry(card, positions.get(card.blockId)!, 'working')
        );

        expect(positions).toEqual(layoutCards(document, 'working'));
        expect(positions.get('pinned')).toEqual(pinned.position);

        for (let index = 0; index < geometry.length; index += 1) {
            for (let other = index + 1; other < geometry.length; other += 1) {
                expect(intersects(geometry[index].bounds, geometry[other].bounds)).toBe(
                    false
                );
            }
        }
    });

    it('bounds cycles and ignores references when assigning containment depth', () => {
        const document = model(
            [
                card('a'),
                card('b'),
                card('definition'),
            ],
            [
                edge('ab', 'a', 'b'),
                edge('ba', 'b', 'a'),
                edge('ref', 'b', 'definition', 'reference'),
            ]
        );
        const positions = layoutCards(document, 'working');

        expect(positions.size).toBe(3);
        expect(positions.get('b')!.x).toBeGreaterThan(positions.get('a')!.x);
        expect(positions.get('definition')!.x).toBe(positions.get('a')!.x);
    });
});

describe('visible working set index', () => {
    it('retains a crossing edge whose endpoints are both outside the viewport', () => {
        const index = new SpatialIndex<{
            bounds: {
                x: number;
                y: number;
                width: number;
                height: number;
            };
            id: string;
        }>();
        index.set('crossing', {
            id: 'crossing',
            bounds: {
                x: -100000,
                y: 150,
                width: 200000,
                height: 2,
            },
        });
        index.set('away', {
            id: 'away',
            bounds: {
                x: 5000,
                y: 5000,
                width: 20,
                height: 20,
            },
        });

        expect(
            index
                .query({
                    x: 0,
                    y: 0,
                    width: 800,
                    height: 600,
                })
                .map(entry => entry.id)
        ).toEqual([
            'crossing',
        ]);
        index.delete('crossing');
        expect(
            index.query({
                x: 0,
                y: 0,
                width: 800,
                height: 600,
            })
        ).toEqual([]);
    });

    it('reuses caller-owned query buffers while clearing prior candidates', () => {
        const index = new SpatialIndex<{
            bounds: {
                x: number;
                y: number;
                width: number;
                height: number;
            };
            id: string;
        }>();
        index.set('first', {
            id: 'first',
            bounds: {
                x: 0,
                y: 0,
                width: 20,
                height: 20,
            },
        });
        index.set('second', {
            id: 'second',
            bounds: {
                x: 800,
                y: 0,
                width: 20,
                height: 20,
            },
        });
        const output: {
            bounds: {
                x: number;
                y: number;
                width: number;
                height: number;
            };
            id: string;
        }[] = [];
        const candidates = new Set<string>();
        expect(
            index.queryInto(
                {
                    x: 0,
                    y: 0,
                    width: 30,
                    height: 30,
                },
                output,
                candidates
            )
        ).toBe(output);
        expect(output.map(item => item.id)).toEqual([
            'first',
        ]);
        expect(
            index.queryInto(
                {
                    x: 790,
                    y: 0,
                    width: 30,
                    height: 30,
                },
                output,
                candidates
            )
        ).toBe(output);
        expect(output.map(item => item.id)).toEqual([
            'second',
        ]);
        expect(candidates.has('first')).toBe(false);
    });

    it('updates moved entries and releases their old cells', () => {
        const index = new SpatialIndex<{
            bounds: {
                x: number;
                y: number;
                width: number;
                height: number;
            };
        }>();
        index.set('a', {
            bounds: {
                x: -10,
                y: -10,
                width: 30,
                height: 30,
            },
        });
        expect(
            index.query({
                x: 0,
                y: 0,
                width: 1,
                height: 1,
            })
        ).toHaveLength(1);
        index.set('a', {
            bounds: {
                x: 5000,
                y: 5000,
                width: 30,
                height: 30,
            },
        });
        expect(
            index.query({
                x: 0,
                y: 0,
                width: 1,
                height: 1,
            })
        ).toEqual([]);
        index.clear();
        expect(
            index.query({
                x: -10000,
                y: -10000,
                width: 20000,
                height: 20000,
            })
        ).toEqual([]);
    });
});

describe('row separators', () => {
    it('hides separators above and below highlighted rows and after the last', () => {
        const selected = new Set([
            2,
        ]);

        expect(
            [
                0,
                1,
                2,
                3,
                4,
                5,
            ].map(index => showSeparator(index, 6, selected))
        ).toEqual([
            true,
            false,
            false,
            true,
            true,
            false,
        ]);
        expect(showSeparator(0, 3, new Set())).toBe(false);
        expect(
            [
                0,
                1,
                2,
            ].map(index => showSeparator(index, 3, new Set(), true))
        ).toEqual([
            true,
            true,
            false,
        ]);
        expect(
            showSeparator(
                0,
                3,
                new Set([
                    1,
                ]),
                true
            )
        ).toBe(false);
        expect(
            showSeparator(
                1,
                3,
                new Set([
                    1,
                ]),
                true
            )
        ).toBe(false);
    });
});
