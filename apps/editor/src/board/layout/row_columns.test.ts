import { expect, it } from 'vitest';
import type { BoardCard, BoardRow } from '../model';
import { cardMetrics, createCardGeometry } from './card_geometry';
import { rowColumns, type RowMeasure } from './row_columns';

const row: BoardRow = {
    memberId: 'category-link',
    name: 'Category',
    typeLabel: 'go to',
    icon: 'reference',
    change: 'unchanged',
    expandable: false,
    expanded: false,
};
const measure: RowMeasure = (value, role) => value.length * (role === 'mono' ? 7 : 7.5);
const card: BoardCard = {
    blockId: 'definition',
    nodeId: 'category',
    collectionId: null,
    title: 'Category',
    display: 'summary',
    width: 127.296875,
    metrics: {
        row: 20,
    },
    pinned: false,
    collapsed: false,
    suggested: false,
    rows: [
        row,
    ],
    rowWindow: {
        firstMemberId: row.memberId,
        totalItems: 1,
        hasMore: false,
        state: 'complete',
    },
};

it('fits both labels of a short reference row without reserving unused glyph space', () => {
    const columns = rowColumns(
        row,
        card.width! - 8,
        'working',
        cardMetrics(card, 'working'),
        measure
    );
    expect(columns.nameWidth).toBeGreaterThanOrEqual(measure('Category', 'body'));
    expect(columns.typeMaxWidth).toBeGreaterThanOrEqual(measure('go to', 'mono'));
    expect(columns.nameX + columns.nameWidth + 8 + columns.typeWidth).toBeLessThanOrEqual(
        columns.right
    );
});

it('uses the same measured columns for input bounds and leaves the type and row highlight exposed', () => {
    const edited: BoardCard = {
        ...card,
        width: 370,
        metrics: {
            row: 34,
        },
        rows: [
            {
                ...row,
                name: 'net_weight',
                typeLabel: 'decimal',
            },
        ],
    };
    const geometry = createCardGeometry(
        edited,
        {
            x: 100,
            y: 200,
        },
        'working',
        [],
        0,
        measure
    );
    const field = geometry.rows[0];
    const name = field.nameBounds!;
    const typeLeft =
        field.bounds.x + field.bounds.width - 10 - measure('decimal', 'mono');
    expect(name.x).toBe(108);
    expect(name.y).toBe(208);
    expect(name.height).toBe(26);
    expect(name.x + name.width).toBeLessThan(typeLeft);
    expect(name.width).toBeGreaterThan(measure('net_weight', 'body'));
});

it('counts emphasized number and secondary suffix widths independently', () => {
    const count = {
        ...row,
        name: 'dimensions',
        typeLabel: 'fields',
        typeCount: 3,
    };
    const columns = rowColumns(
        count,
        322,
        'working',
        cardMetrics(card, 'working'),
        measure
    );
    expect(columns.type).toBe('3 fields');
    expect(columns.typeWidth).toBe(
        measure('3', 'body', true) + measure(' fields', 'mono')
    );
});
