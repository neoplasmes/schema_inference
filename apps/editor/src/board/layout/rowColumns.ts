import type { BoardLod, BoardRow } from '../model';
import type { cardMetrics } from './cardGeometry';

export type RowTextRole = 'body' | 'mono' | 'footnote' | 'count';
export type RowMeasure = (text: string, role: RowTextRole, bold?: boolean) => number;

export function rowColumns(
    row: BoardRow,
    width: number,
    lod: BoardLod,
    metrics: ReturnType<typeof cardMetrics>,
    measure: RowMeasure,
    hovered = false
) {
    const narrow = !metrics.reserveGlyphColumn && width < 150;
    const right = width - (narrow ? 6 : 10);
    const nameX =
        metrics.reserveGlyphColumn || hovered || row.change !== 'unchanged'
            ? 32
            : narrow
              ? 6
              : 10;
    const gap = narrow ? 8 : 12;
    const occurrence =
        !metrics.occurrenceColumn && row.occurrenceLabel === '1'
            ? undefined
            : row.occurrenceLabel;
    let reserve = 0;
    let typeMaxWidth = 0;
    let typeWidth = 0;
    const type = `${row.typeCount === undefined ? '' : `${row.typeCount} `}${row.typeLabel}${occurrence && !metrics.occurrenceColumn ? ` · ${occurrence}` : ''}`;

    if (row.variantsCount) {
        reserve = measure(`${row.variantsCount} variants`, 'footnote') + 22;
    } else {
        if (lod === 'detailed' && row.observation) {
            reserve +=
                measure(`${row.observation.count}/${row.observation.total}`, 'count') +
                12;
        }

        if (metrics.occurrenceColumn && occurrence) {
            reserve += 54;
        }

        if (type) {
            const nameMinimum = narrow
                ? measure(row.name, 'body')
                : Math.max(0, 90 - (width - right) - gap - nameX);
            typeMaxWidth = Math.min(
                narrow ? width : width * 0.48,
                Math.max(0, right - reserve - nameX - gap - nameMinimum)
            );
            typeWidth = Math.min(
                typeMaxWidth,
                row.typeCount === undefined
                    ? measure(type, row.typeEmphasis ? 'body' : 'mono', row.typeEmphasis)
                    : measure(String(row.typeCount), 'body', true) +
                          measure(` ${row.typeLabel}`, 'mono')
            );
            reserve += typeWidth + gap;
        }
    }

    return {
        right,
        nameX,
        nameWidth: Math.max(0, right - reserve - nameX),
        type,
        typeMaxWidth,
        typeWidth,
        occurrence,
    };
}
