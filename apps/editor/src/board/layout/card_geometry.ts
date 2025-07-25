import type { BoardCard, BoardLod, BoardModel, Point } from '../model/types';
import type {
    BoardCardGeometry,
    BoardConnectionGeometry,
    BoardGeometry,
    BoardHitRegion,
    Rectangle,
} from '../render/types';

export const CARD = {
    padding: 4,
    header: 34,
    row: 28,
    footer: 28,
    variant: 47,
    gapX: 80,
    gapY: 44,
    width: 248,
} as const;

export function cardMetrics(card: BoardCard, lod: BoardLod) {
    const detailed = lod === 'detailed';
    const rowGlyphs =
        card.metrics?.rowGlyphs ?? (!detailed && (card.width ?? CARD.width) > 190);

    return {
        header: detailed ? 44 : CARD.header,
        row: detailed ? 38 : CARD.row,
        boundary: detailed ? 32 : CARD.row,
        footer: detailed ? 36 : CARD.footer,
        warning: detailed ? 52 : 44,
        note: detailed ? 40 : 28,
        occurrenceColumn: false,
        rowGlyphs,
        separators: card.display !== 'summary' && rowGlyphs,
        reserveGlyphColumn: card.display !== 'summary' && rowGlyphs,
        ...card.metrics,
    };
}

export const CARD_ROW_LIMIT = 10;

export function rowWindowFor(card: BoardCard, lod: BoardLod, offset = 0) {
    const metrics = cardMetrics(card, lod);
    const rowHeight = (index: number) =>
        metrics.row +
        (lod === 'detailed' && card.rows[index].warning ? metrics.warning : 0);
    const limit = Math.max(
        1,
        Math.min(CARD_ROW_LIMIT, Math.floor(card.metrics?.rowLimit ?? CARD_ROW_LIMIT))
    );
    const budget = metrics.row * limit;
    let lastStart = card.rows.length;
    let lastHeight = 0;

    while (
        lastStart > 0 &&
        card.rows.length - lastStart < limit &&
        lastHeight + rowHeight(lastStart - 1) <= budget
    ) {
        lastStart -= 1;
        lastHeight += rowHeight(lastStart);
    }

    const firstIndex = Math.min(Math.max(0, Math.floor(offset)), Math.max(0, lastStart));
    let endIndex = firstIndex;
    let height = 0;

    while (
        endIndex < card.rows.length &&
        endIndex - firstIndex < limit &&
        (height + rowHeight(endIndex) <= budget || endIndex === firstIndex)
    ) {
        height += rowHeight(endIndex);
        endIndex += 1;
    }

    return {
        firstIndex,
        endIndex,
        lastStart,
        height,
        rows: card.rows.slice(firstIndex, endIndex),
    };
}

export function needsFooter(card: BoardCard, lod: BoardLod = 'working'): boolean {
    return (
        card.rowWindow.state !== 'complete' ||
        card.rowWindow.hasMore ||
        card.rowWindow.loadedItems !== undefined ||
        card.rows.length === 0 ||
        rowWindowFor(card, lod).rows.length < card.rows.length
    );
}

export function footerHeight(card: BoardCard, lod: BoardLod): number {
    return !card.rows.length && card.rowWindow.state === 'complete'
        ? Math.max(49, cardMetrics(card, lod).footer)
        : cardMetrics(card, lod).footer;
}

export function hiddenSourceMembers(
    model: BoardModel,
    visibleRows?: ReadonlyMap<string, ReadonlySet<string>>
): Map<string, readonly string[]> {
    const cards = new Map(
        model.cards.map(card => [
            card.blockId,
            card.collapsed
                ? new Set<string>()
                : (visibleRows?.get(card.blockId) ??
                  new Set(card.rows.map(row => row.memberId))),
        ])
    );
    const hidden = new Map<string, Set<string>>();

    for (const connection of model.connections) {
        const rows = cards.get(connection.sourceBlockId);

        if (rows && !rows.has(connection.sourceMemberId)) {
            let members = hidden.get(connection.sourceBlockId);

            if (!members) {
                members = new Set();
                hidden.set(connection.sourceBlockId, members);
            }

            members.add(connection.sourceMemberId);
        }
    }

    return new Map([...hidden].map(([id, members]) => [id, [...members]]));
}

export function cardSize(
    card: BoardCard,
    lod: BoardLod,
    hiddenCount = 0,
    rowOffset = 0
): { width: number; height: number } {
    const width = card.width ?? CARD.width;
    const metrics = cardMetrics(card, lod);

    if (lod === 'overview') {
        return { width: card.width ?? 138, height: width <= 90 ? 52 : 56 };
    }

    if (card.rowWindow.state === 'loading' && !card.rows.length) {
        return { width, height: 54 };
    }

    const window = rowWindowFor(card, lod, rowOffset);

    if (card.display === 'summary') {
        return { width, height: 8 + Math.max(1, window.rows.length) * metrics.row };
    }

    const contentHeight = card.collapsed ? 0 : window.height;

    return {
        width,
        height:
            CARD.padding * 2 +
            metrics.header +
            contentHeight +
            (card.variants?.length ? CARD.variant : 0) +
            (needsFooter(card, lod) || card.collapsed ? footerHeight(card, lod) : 0) +
            (hiddenCount ? metrics.boundary : 0) +
            (card.note ? metrics.note : 0),
    };
}

export function createCardGeometry(
    card: BoardCard,
    position: Point,
    lod: BoardLod,
    hiddenMembers: readonly string[] = [],
    rowOffset = 0
): BoardCardGeometry {
    const size = cardSize(card, lod, hiddenMembers.length, rowOffset);
    const window = rowWindowFor(card, lod, rowOffset);
    const metrics = cardMetrics(card, lod);
    const bounds = { ...position, ...size };
    const header = {
        x: position.x + 4,
        y: position.y + 4,
        width: size.width - 8,
        height: metrics.header,
    };
    const regions: BoardHitRegion[] = [
        { bounds: header, target: { kind: 'header', blockId: card.blockId } },
    ];
    const rows: { memberId: string; bounds: Rectangle }[] = [];
    const branches: NonNullable<BoardCardGeometry['branches']>[number][] = [];
    let y = header.y + header.height;

    if (lod === 'overview') {
        regions[0] = { bounds, target: { kind: 'header', blockId: card.blockId } };

        return { blockId: card.blockId, bounds, header, rows, regions };
    }

    if (!card.rows.length && card.rowWindow.state === 'loading') {
        return { blockId: card.blockId, bounds, header, rows, regions };
    }

    if (card.display === 'summary') {
        regions[0] = { bounds, target: { kind: 'header', blockId: card.blockId } };

        window.rows.forEach((row, index) => {
            const rowBounds = {
                x: position.x + 4,
                y: position.y + 4 + index * metrics.row,
                width: size.width - 8,
                height: metrics.row,
            };
            rows.push({ memberId: row.memberId, bounds: rowBounds });
            regions.push({
                bounds: rowBounds,
                target: { kind: 'row', blockId: card.blockId, memberId: row.memberId },
            });

            if (row.expandable) {
                regions.push({
                    bounds: {
                        ...rowBounds,
                        x: rowBounds.x + rowBounds.width - 24,
                        width: 24,
                    },
                    target: {
                        kind: 'expand',
                        blockId: card.blockId,
                        memberId: row.memberId,
                    },
                });
            }

            if (row.expandable && !row.expanded && row.branch) {
                const pill = {
                    x: position.x + size.width + 28,
                    y: rowBounds.y,
                    width: row.branch.totalItems === null ? 160 : 123,
                    height: 28,
                };
                branches.push({ memberId: row.memberId, bounds: pill, ...row.branch });
                regions.push({
                    bounds: pill,
                    target: {
                        kind: 'expand',
                        blockId: card.blockId,
                        memberId: row.memberId,
                    },
                });
            }
        });

        if (
            !card.rows.length &&
            card.collectionId &&
            card.rowWindow.state === 'notRequested'
        ) {
            regions.push({
                bounds: {
                    ...bounds,
                    x: bounds.x + bounds.width / 2,
                    width: bounds.width / 2,
                },
                target: {
                    kind: 'more',
                    blockId: card.blockId,
                    collectionId: card.collectionId,
                },
            });
        }

        const visibilityBounds = branches.length
            ? {
                  ...bounds,
                  width:
                      size.width +
                      28 +
                      Math.max(...branches.map(branch => branch.bounds.width)),
              }
            : bounds;

        return {
            blockId: card.blockId,
            bounds,
            header: { ...header, height: metrics.row },
            rows,
            regions,
            branches,
            visibilityBounds,
            rowViewport: {
                firstIndex: window.firstIndex,
                endIndex: window.endIndex,
                totalItems: card.rows.length,
                bounds: {
                    x: header.x,
                    y: position.y + 4,
                    width: header.width,
                    height: window.rows.length * metrics.row,
                },
            },
        };
    }

    if (card.variants?.length) {
        const variantWidth = (size.width - 16) / card.variants.length;

        card.variants.forEach((variant, index) => {
            regions.push({
                bounds: {
                    x: position.x + 8 + index * variantWidth,
                    y,
                    width: variantWidth,
                    height: CARD.variant,
                },
                target: {
                    kind: 'variant',
                    blockId: card.blockId,
                    variantId: variant.variantId,
                    scopeId: variant.scopeId,
                },
            });
        });

        y += CARD.variant;
    }

    if (hiddenMembers.length) {
        hiddenMembers.forEach((memberId, index) => {
            regions.push({
                bounds: {
                    x: header.x + (index * header.width) / hiddenMembers.length,
                    y,
                    width: header.width / hiddenMembers.length,
                    height: metrics.boundary,
                },
                target: { kind: 'boundary', blockId: card.blockId, memberId },
            });
        });

        y += metrics.boundary;
    }

    const rowsTop = y;

    if (!card.collapsed) {
        for (const row of window.rows) {
            const rowBounds = {
                x: header.x,
                y,
                width: header.width,
                height: metrics.row,
            };
            rows.push({ memberId: row.memberId, bounds: rowBounds });
            regions.push({
                bounds: rowBounds,
                target: { kind: 'row', blockId: card.blockId, memberId: row.memberId },
            });

            if (row.expandable) {
                regions.push({
                    bounds: {
                        x: rowBounds.x + rowBounds.width - 24,
                        y,
                        width: 24,
                        height: metrics.row,
                    },
                    target: {
                        kind: 'expand',
                        blockId: card.blockId,
                        memberId: row.memberId,
                    },
                });
            }

            if (row.expandable && !row.expanded && row.branch) {
                const pill = {
                    x: position.x + size.width + 32,
                    y: y + (metrics.row - 28) / 2,
                    width: row.branch.totalItems === null ? 200 : 180,
                    height: 28,
                };
                branches.push({ memberId: row.memberId, bounds: pill, ...row.branch });
                regions.push({
                    bounds: pill,
                    target: {
                        kind: 'expand',
                        blockId: card.blockId,
                        memberId: row.memberId,
                    },
                });
            }

            y += metrics.row + (lod === 'detailed' && row.warning ? metrics.warning : 0);
        }
    }

    if (
        (needsFooter(card, lod) || card.collapsed) &&
        card.collectionId &&
        card.rowWindow.state !== 'loading'
    ) {
        regions.push({
            bounds: {
                x: header.x,
                y,
                width: header.width,
                height: footerHeight(card, lod),
            },
            target: {
                kind: 'more',
                blockId: card.blockId,
                collectionId: card.collectionId,
            },
        });
    }

    if (
        card.collectionId &&
        ((!card.rows.length && card.rowWindow.state === 'complete') ||
            card.note?.startsWith('+'))
    ) {
        const top = !card.rows.length
            ? y + footerHeight(card, lod) / 2
            : y + (needsFooter(card, lod) ? footerHeight(card, lod) : 0);
        regions.push({
            bounds: {
                x: header.x,
                y: top,
                width: header.width,
                height: !card.rows.length ? footerHeight(card, lod) / 2 : metrics.note,
            },
            target: {
                kind: 'add',
                blockId: card.blockId,
                collectionId: card.collectionId,
            },
        });
    }

    const visibilityBounds = branches.length
        ? {
              ...bounds,
              width:
                  size.width +
                  32 +
                  Math.max(...branches.map(branch => branch.bounds.width)),
          }
        : bounds;

    return {
        blockId: card.blockId,
        bounds,
        header,
        rows,
        regions,
        branches,
        visibilityBounds,
        rowViewport: {
            firstIndex: window.firstIndex,
            endIndex: window.endIndex,
            totalItems: card.rows.length,
            bounds: {
                x: header.x,
                y: rowsTop,
                width: header.width,
                height: card.collapsed ? 0 : window.height,
            },
        },
    };
}

export function rowScrollbar(card: BoardCard, geometry: BoardCardGeometry) {
    const viewport = geometry.rowViewport;

    if (
        !viewport ||
        viewport.bounds.height <= 0 ||
        (card.rowWindow.firstIndex === undefined &&
            viewport.totalItems <= geometry.rows.length)
    ) {
        return null;
    }

    const loaded = Math.max(
        card.rows.length,
        card.rowWindow.loadedItems ?? card.rows.length
    );
    const presentationOffset =
        loaded > card.rows.length ? (card.rowWindow.firstIndex ?? 0) : 0;
    const visible = geometry.rows.length;
    const maximum = Math.max(0, loaded - visible);
    const first = Math.min(
        maximum,
        Math.max(0, presentationOffset + viewport.firstIndex)
    );
    const trackTop = viewport.bounds.y - geometry.bounds.y + 2;
    const trackHeight = Math.max(3, viewport.bounds.height - 4);
    const thumbHeight = Math.min(
        trackHeight,
        Math.max(18, (trackHeight * visible) / Math.max(1, loaded))
    );
    const thumbTop =
        trackTop + ((trackHeight - thumbHeight) * first) / Math.max(1, maximum);

    return { trackTop, trackHeight, thumbTop, thumbHeight };
}

export function connectionGeometry(
    id: string,
    memberId: string,
    source: BoardCardGeometry,
    target: BoardCardGeometry,
    lod: BoardLod
): BoardConnectionGeometry {
    const row = source.rows.find(row => row.memberId === memberId);
    const boundary = source.regions.find(
        region => region.target.kind === 'boundary' && region.target.memberId === memberId
    )?.bounds;
    const sourceBounds =
        lod === 'overview' ? source.header : (row?.bounds ?? boundary ?? source.header);
    const from = {
        x: source.bounds.x + source.bounds.width,
        y: sourceBounds.y + sourceBounds.height / 2,
    };
    const to = { x: target.bounds.x, y: target.header.y + target.header.height / 2 };
    const bend = Math.max(40, Math.abs(to.x - from.x) / 2);
    const left = Math.min(from.x, to.x - bend);
    const right = Math.max(to.x, from.x + bend);

    return {
        id,
        source: from,
        target: to,
        sourceHidden: lod !== 'overview' && !row,
        bounds: {
            x: left,
            y: Math.min(from.y, to.y) - 2,
            width: right - left,
            height: Math.abs(from.y - to.y) + 4,
        },
    };
}

export function aggregateBounds(cards: readonly BoardCardGeometry[]): Rectangle {
    if (!cards.length) {
        return { x: 0, y: 0, width: 0, height: 0 };
    }

    let x = Infinity;
    let y = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;

    for (const card of cards) {
        const bounds = card.visibilityBounds ?? card.bounds;
        x = Math.min(x, bounds.x);
        y = Math.min(y, bounds.y);
        right = Math.max(right, bounds.x + bounds.width);
        bottom = Math.max(bottom, bounds.y + bounds.height);
    }

    return { x, y, width: right - x, height: bottom - y };
}

export const EMPTY_GEOMETRY: BoardGeometry = {
    version: 0,
    cards: [],
    connections: [],
    bounds: { x: 0, y: 0, width: 0, height: 0 },
};
