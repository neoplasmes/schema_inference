import type { BoardRow, BoardLod } from '../../model';
import type { cardMetrics } from '../../layout';
import { rowColumns } from '../../layout';
import type { LabelMetrics } from '../../text';
import { themeRadius, type ColorName } from '../../theme';
import { LabelGroup } from '../labels';

export class RowView extends LabelGroup {
    private signature = '';
    private previousRow: BoardRow | null = null;
    private rowSignature = '';

    update(
        row: BoardRow,
        width: number,
        lod: BoardLod,
        selected: boolean,
        hovered: boolean,
        separator: boolean,
        y: number,
        height: number,
        metrics: ReturnType<typeof cardMetrics>
    ): void {
        this.root.position.set(4, y);
        const signature = `${width}:${lod}:${selected}:${hovered}:${separator}:${height}:${metrics.warning}:${metrics.occurrenceColumn}:${metrics.rowGlyphs}:${metrics.reserveGlyphColumn}`;
        const rowSignature =
            this.previousRow === row ? this.rowSignature : JSON.stringify(row);

        this.previousRow = row;

        if (this.signature === signature && this.rowSignature === rowSignature) {
            return;
        }

        this.signature = signature;
        this.rowSignature = rowSignature;
        this.begin();
        const g = this.graphics;
        const columns = rowColumns(
            row,
            width,
            lod,
            metrics,
            (value, role, bold) => this.rowMetrics.width(value, role, bold),
            hovered
        );
        const right = columns.right;
        const center = height / 2;
        const ink: ColorName =
            row.change === 'removed'
                ? 'label-removed'
                : row.change === 'added'
                  ? 'accent-ink'
                  : 'label';

        if (selected || hovered) {
            g.roundRect(
                0,
                0,
                width,
                height,
                themeRadius(this.rowMetrics.theme, 'radius-sm')
            ).fill(this.paint(selected ? 'accent-fill' : 'fill-hover'));
        }

        if (separator) {
            g.rect(20, height - 1, width - 40, 1).fill(this.paint('separator'));
        }

        if (row.change !== 'unchanged') {
            this.label('change', {
                text: row.change === 'added' ? '+' : '−',
                x: 10,
                y: center,
                ink,
                bold: true,
            });
        } else if (hovered) {
            for (const offset of [
                -4,
                0,
                4,
            ]) {
                g.circle(13, center + offset, 0.8).fill(this.paint('label-tertiary'));
            }
        } else if (
            metrics.rowGlyphs &&
            (row.icon === 'attribute' || row.icon === 'reference' || row.icon === 'group')
        ) {
            this.label('glyph', {
                text:
                    row.icon === 'attribute' ? '@' : row.icon === 'reference' ? '↗' : '◇',
                x: 10,
                y: center,
                role: 'mono',
                ink: 'label-tertiary',
            });
        }

        let reserve = 0;

        if ((selected || hovered) && row.expandable) {
            g.circle(width + 4, center, 3.5).fill(
                this.paint(selected ? 'accent' : 'label-tertiary')
            );
        }

        if (row.variantsCount) {
            const label = `${row.variantsCount} variants`;
            const chipWidth = this.metricsWidth(label, 'footnote') + 14;
            const x = right - reserve - chipWidth;
            g.roundRect(x, center - 9, chipWidth, 18, 9).fill(
                this.paint(selected ? 'chip-on-accent' : 'fill-control')
            );
            this.label('variants', {
                text: label,
                x: x + 7,
                y: center,
                role: 'footnote',
                ink: selected ? 'accent-ink' : 'label',
                bold: true,
            });
            reserve += chipWidth + 8;
        } else {
            const occurrence = columns.occurrence;
            const observation =
                lod === 'detailed' && row.observation
                    ? `${row.observation.count}/${row.observation.total}`
                    : '';

            if (observation) {
                const total = `/${row.observation!.total}`;
                const count = String(row.observation!.count);
                const totalWidth = this.metricsWidth(total, 'count');
                this.label('observation-total', {
                    text: total,
                    x: right - reserve,
                    y: center,
                    right: true,
                    role: 'subheadline',
                    ink: row.change === 'removed' ? 'label-removed' : 'label-secondary',
                });
                this.label('observation', {
                    text: count,
                    x: right - reserve - totalWidth,
                    y: center,
                    right: true,
                    role: 'count',
                    ink: row.change === 'removed' ? 'label-removed' : 'label',
                    bold: true,
                });
                reserve += this.metricsWidth(observation, 'count') + 12;
            }

            if (metrics.occurrenceColumn && occurrence) {
                this.label('occurrence', {
                    text: occurrence,
                    x: right - reserve - 8,
                    y: center,
                    right: true,
                    role: 'count',
                    bold: true,
                    ink,
                });
                reserve += 54;
            }

            if (columns.type) {
                const x = right - reserve;
                const removed = row.change === 'removed';

                if (row.typeCount !== undefined) {
                    const suffix = ` ${row.typeLabel}`;
                    const suffixWidth = this.metricsWidth(suffix, 'mono');
                    this.label('type-count', {
                        text: String(row.typeCount),
                        x: x - suffixWidth,
                        y: center,
                        role: 'body',
                        ink: removed ? 'label-removed' : 'label',
                        bold: true,
                        right: true,
                        maxWidth: Math.max(0, columns.typeMaxWidth - suffixWidth),
                    });
                    this.label('type', {
                        text: suffix,
                        x,
                        y: center,
                        role: 'mono',
                        ink: removed ? 'label-removed' : 'label-secondary',
                        right: true,
                        maxWidth: columns.typeMaxWidth,
                    });
                } else {
                    this.label('type', {
                        text: columns.type,
                        x,
                        y: center,
                        role: row.typeEmphasis ? 'body' : 'mono',
                        ink: removed
                            ? 'label-removed'
                            : row.typeEmphasis
                              ? 'label'
                              : 'label-secondary',
                        bold: row.typeEmphasis,
                        right: true,
                        maxWidth: columns.typeMaxWidth,
                    });
                }
            }
        }

        const nameX = columns.nameX;
        const nameWidth = columns.nameWidth;
        const invalid = !row.name.trim();
        this.label('name', {
            text: invalid ? 'Name required' : row.name,
            x: nameX,
            y: center,
            ink: invalid ? 'danger' : ink,
            bold: selected,
            italic: invalid,
            maxWidth: nameWidth,
        });

        if (row.nameAlias) {
            const x =
                nameX + Math.min(nameWidth, this.metricsWidth(row.name, 'body')) + 6;
            this.label('alias', {
                text: row.nameAlias,
                x,
                y: center,
                role: 'subheadline',
                ink: 'label-secondary',
                maxWidth: Math.max(0, nameX + nameWidth - x),
            });
        }

        if (lod === 'detailed' && row.warning) {
            g.roundRect(
                0,
                height,
                width,
                metrics.warning - 4,
                themeRadius(this.rowMetrics.theme, 'radius-sm')
            ).fill(this.paint('fill-hover'));
            const [warning, detail] = row.warning.split('\n');
            this.label('warning', {
                text: warning,
                x: 10,
                y: height + (detail ? 15 : metrics.warning / 2),
                role: 'subheadline',
                maxWidth: width - 20,
                bold: true,
            });

            if (detail) {
                this.label('warning-detail', {
                    text: detail,
                    x: 10,
                    y: height + 32,
                    role: 'mono',
                    ink: 'label-secondary',
                    maxWidth: width - 20,
                });
            }
        }

        this.end();
    }

    private metricsWidth(
        value: string,
        role: 'body' | 'mono' | 'footnote' | 'count',
        bold = false
    ): number {
        return this.rowMetrics.width(value, role, bold);
    }

    constructor(
        private readonly rowMetrics: LabelMetrics,
        resolution: number
    ) {
        super(rowMetrics, resolution);
    }
}
