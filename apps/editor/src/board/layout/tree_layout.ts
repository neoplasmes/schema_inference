import type { BoardLod, BoardModel, Point } from '../model';
import { CARD, cardSize } from './card_geometry';
import { SpatialIndex } from './spatial_index';

function layoutSize(card: BoardModel['cards'][number], lod: BoardLod, hiddenCount = 0) {
    const size = cardSize(card, lod, hiddenCount);
    let extra = 0;

    if (lod !== 'overview' && !card.collapsed) {
        for (const row of card.rows) {
            if (row.expandable && !row.expanded && row.branch) {
                extra = Math.max(
                    extra,
                    card.display === 'summary'
                        ? 28 + (row.branch.totalItems === null ? 160 : 123)
                        : 32 + (row.branch.totalItems === null ? 200 : 180)
                );
            }
        }
    }

    return {
        ...size,
        width: size.width + extra,
    };
}

/** Explicit positions remain authoritative; containment alone assigns automatic columns. */
export function layoutCards(
    model: BoardModel,
    lod: BoardLod,
    hidden: ReadonlyMap<string, readonly string[]> = new Map()
): Map<string, Point> {
    const cards = new Map(
        model.cards.map(card => [
            card.blockId,
            card,
        ])
    );
    const children = new Map<string, string[]>();
    const incoming = new Set<string>();

    for (const edge of model.connections) {
        if (
            edge.kind !== 'containment' ||
            !cards.has(edge.sourceBlockId) ||
            !cards.has(edge.targetBlockId)
        ) {
            continue;
        }

        const list = children.get(edge.sourceBlockId) ?? [];
        list.push(edge.targetBlockId);
        children.set(edge.sourceBlockId, list);
        incoming.add(edge.targetBlockId);
    }

    const depth = new Map<string, number>();
    const queue = model.cards
        .filter(card => !incoming.has(card.blockId))
        .map(card => ({
            id: card.blockId,
            level: 0,
        }));
    let cursor = 0;
    let component = 0;

    while (cursor < queue.length || component < model.cards.length) {
        if (cursor === queue.length) {
            const id = model.cards[component++].blockId;

            if (!depth.has(id)) {
                queue.push({
                    id,
                    level: 0,
                });
            }

            continue;
        }

        const { id, level } = queue[cursor++];

        if (!depth.has(id)) {
            depth.set(id, level);

            for (const child of children.get(id) ?? []) {
                queue.push({
                    id: child,
                    level: level + 1,
                });
            }
        }
    }

    const widths = new Map<number, number>();

    for (const card of model.cards) {
        const level = depth.get(card.blockId) ?? 0;
        widths.set(
            level,
            Math.max(
                widths.get(level) ?? 0,
                layoutSize(card, lod, hidden.get(card.blockId)?.length).width
            )
        );
    }

    const columns = new Map<number, number>();
    let x = 300;

    for (let level = 0; level < widths.size; level += 1) {
        columns.set(level, x);
        x += (widths.get(level) ?? CARD.width) + CARD.gapX;
    }

    const positions = new Map<string, Point>();
    const occupied = new SpatialIndex<{
        bounds: {
            x: number;
            y: number;
            width: number;
            height: number;
        };
    }>();

    for (const card of model.cards) {
        if (card.position) {
            occupied.set(card.blockId, {
                bounds: {
                    ...card.position,
                    ...layoutSize(card, lod, hidden.get(card.blockId)?.length),
                },
            });
        }
    }
    const bottoms = new Map<number, number>();

    for (const card of model.cards) {
        if (card.position) {
            positions.set(card.blockId, card.position);

            continue;
        }

        const level = depth.get(card.blockId) ?? 0;
        const size = layoutSize(card, lod, hidden.get(card.blockId)?.length);
        const bounds = {
            x: columns.get(level) ?? 300,
            y: bottoms.get(level) ?? 110,
            ...size,
        };
        let collision = occupied.query({
            ...bounds,
            height: bounds.height + CARD.gapY,
        })[0];

        while (collision) {
            bounds.y = collision.bounds.y + collision.bounds.height + CARD.gapY;
            collision = occupied.query({
                ...bounds,
                height: bounds.height + CARD.gapY,
            })[0];
        }

        positions.set(card.blockId, {
            x: bounds.x,
            y: bounds.y,
        });
        occupied.set(card.blockId, {
            bounds,
        });
        bottoms.set(level, bounds.y + bounds.height + CARD.gapY);
    }

    return positions;
}
