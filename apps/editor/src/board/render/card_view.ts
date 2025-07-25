import { Container, Graphics, NineSliceSprite, type Texture } from 'pixi.js';
import type { BoardCard, BoardLod, BoardRow, BoardSelection } from '../model/types';
import type { BoardCardGeometry } from './types';
import {
    CARD,
    cardMetrics,
    needsFooter,
    footerHeight,
    rowScrollbar,
} from '../layout/card_geometry';
import { showSeparator } from '../layout/row_states';
import { RetainedLabel, type LabelMetrics, type LabelSpec } from '../text/labels';
import { paint as themePaint, type ColorName } from './colors';
import { themeRadius, type ResolvedBoardTheme } from './theme';

class LabelGroup {
    readonly root = new Container();
    readonly graphics = new Graphics();
    private readonly labels = new Map<string, RetainedLabel>();
    private readonly used = new Set<string>();

    constructor(
        private readonly metrics: LabelMetrics,
        private resolution: number
    ) {
        this.root.addChild(this.graphics);
    }

    protected paint(name: ColorName) {
        return themePaint(name, this.metrics.theme);
    }

    begin(): void {
        this.used.clear();
        this.graphics.clear();
    }

    label(key: string, spec: LabelSpec): void {
        let label = this.labels.get(key);

        if (!label) {
            label = new RetainedLabel(this.metrics, this.resolution);
            this.labels.set(key, label);
            this.root.addChild(label.view);
        }

        this.used.add(key);
        label.update(spec);
    }

    end(): void {
        for (const [key, label] of this.labels) {
            if (!this.used.has(key)) {
                this.root.removeChild(label.view);
                label.view.destroy();
                this.labels.delete(key);
            }
        }
    }

    setResolution(resolution: number): void {
        this.resolution = resolution;

        for (const label of this.labels.values()) {
            label.view.resolution = resolution;
        }
    }

    get textCount(): number {
        return this.labels.size;
    }

    destroy(): void {
        this.root.destroy({ children: true });
        this.labels.clear();
    }
}

class RowView extends LabelGroup {
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
        const right = width - 10;
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
            for (const offset of [-4, 0, 4]) {
                g.circle(13, center + offset, 0.8).fill(this.paint('label-tertiary'));
            }
        } else if (
            metrics.rowGlyphs &&
            (row.icon === 'attribute' || row.icon === 'reference' || row.icon === 'group')
        ) {
            this.label('glyph', {
                text:
                    row.icon === 'attribute'
                        ? '@'
                        : row.icon === 'reference'
                          ? '↗'
                          : '◇',
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
            const occurrence =
                !metrics.occurrenceColumn && row.occurrenceLabel === '1'
                    ? undefined
                    : row.occurrenceLabel;
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

            const type = `${row.typeLabel}${occurrence && !metrics.occurrenceColumn ? ` · ${occurrence}` : ''}`;

            if (type) {
                const maxWidth = Math.min(
                    width * 0.48,
                    Math.max(0, width - reserve - 90)
                );
                this.label('type', {
                    text: type,
                    x: right - reserve,
                    y: center,
                    role: row.typeEmphasis ? 'body' : 'mono',
                    ink:
                        row.change === 'removed'
                            ? 'label-removed'
                            : row.typeEmphasis
                              ? 'label'
                              : 'label-secondary',
                    bold: row.typeEmphasis,
                    right: true,
                    maxWidth,
                });
                reserve +=
                    Math.min(
                        maxWidth,
                        this.metricsWidth(
                            type,
                            row.typeEmphasis ? 'body' : 'mono',
                            row.typeEmphasis
                        )
                    ) + 12;
            }
        }

        const nameX =
            metrics.reserveGlyphColumn || hovered || row.change !== 'unchanged' ? 32 : 10;
        const nameWidth = Math.max(0, right - reserve - nameX);
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
                maxWidth: Math.max(0, right - reserve - x),
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

export class CardView {
    readonly root = new Container();
    private readonly body = new Graphics();
    private readonly shadow: NineSliceSprite;
    private readonly chrome: LabelGroup;
    private readonly rowViews = new Map<string, RowView>();
    private chromeSignature = '';
    private rowModels = new Map<string, BoardRow>();
    private previousCard: BoardCard | null = null;
    private previousChromeCard: BoardCard | null = null;
    private chromeContent = '';

    constructor(
        private readonly metrics: LabelMetrics,
        shadow: Texture,
        private resolution: number,
        private readonly theme: ResolvedBoardTheme
    ) {
        this.shadow = new NineSliceSprite({
            texture: shadow,
            leftWidth: 28,
            rightWidth: 28,
            topHeight: 28,
            bottomHeight: 28,
        });
        this.chrome = new LabelGroup(metrics, resolution);
        this.root.eventMode = 'none';
        this.root.addChild(this.shadow, this.body, this.chrome.root);
    }

    sync(
        card: BoardCard,
        geometry: BoardCardGeometry,
        lod: BoardLod,
        selection: BoardSelection | null,
        hover: BoardSelection | null,
        draggedMemberId?: string
    ): void {
        this.root.position.set(geometry.bounds.x, geometry.bounds.y);
        const metrics = cardMetrics(card, lod);

        if (this.previousCard !== card) {
            this.rowModels = new Map(card.rows.map(row => [row.memberId, row]));
            this.previousCard = card;
        }

        const selectedHeader =
            selection?.blockId === card.blockId && selection.memberId === null;
        const hoveredHeader = hover?.blockId === card.blockId && hover.memberId === null;
        const firstMemberId = geometry.rows[0]?.memberId;
        const firstHighlighted = [selection, hover].some(
            item => item?.blockId === card.blockId && item.memberId === firstMemberId
        );
        const chromeSignature = `${geometry.bounds.width}:${geometry.bounds.height}:${lod}:${selectedHeader}:${hoveredHeader}:${firstHighlighted}:${geometry.rowViewport?.firstIndex}:${geometry.rowViewport?.endIndex}:${JSON.stringify(geometry.branches?.map(branch => [branch.memberId, branch.bounds.y - geometry.bounds.y, branch.totalItems, branch.state]))}`;
        const chromeContent =
            this.previousChromeCard === card
                ? this.chromeContent
                : JSON.stringify([
                      card.title,
                      card.subtitle,
                      card.subtitleEmphasis,
                      card.namespace,
                      card.note,
                      card.display,
                      card.metrics,
                      card.variants,
                      card.activeVariantId,
                      card.suggested,
                      card.collapsed,
                      card.rowWindow,
                  ]);
        this.previousChromeCard = card;

        if (
            this.chromeSignature !== chromeSignature ||
            this.chromeContent !== chromeContent
        ) {
            this.chromeSignature = chromeSignature;
            this.chromeContent = chromeContent;
            this.updateChrome(
                card,
                geometry,
                lod,
                selectedHeader,
                hoveredHeader,
                firstHighlighted
            );
        }

        const visible = new Set<string>();
        const highlighted = new Set<number>();

        if (selectedHeader || hoveredHeader) {
            highlighted.add(0);
        }

        for (const item of [selection, hover]) {
            if (item?.blockId === card.blockId && item.memberId !== null) {
                const index = geometry.rows.findIndex(
                    row => row.memberId === item.memberId
                );

                if (index >= 0) {
                    highlighted.add(index + 1);
                }
            }
        }

        for (let index = 0; index < geometry.rows.length; index += 1) {
            const rowGeometry = geometry.rows[index];

            const row = this.rowModels.get(rowGeometry.memberId);

            if (!row) {
                continue;
            }

            visible.add(row.memberId);
            let view = this.rowViews.get(row.memberId);

            if (!view) {
                view = new RowView(this.metrics, this.resolution);
                this.rowViews.set(row.memberId, view);
                this.root.addChild(view.root);
            }

            view.root.alpha = draggedMemberId === row.memberId ? 0.35 : 1;
            view.update(
                row,
                geometry.bounds.width - 8,
                card.display === 'summary' ? 'working' : lod,
                selection?.blockId === card.blockId &&
                    selection.memberId === row.memberId,
                hover?.blockId === card.blockId && hover.memberId === row.memberId,
                metrics.separators &&
                    showSeparator(index + 1, geometry.rows.length + 1, highlighted),
                rowGeometry.bounds.y - geometry.bounds.y,
                rowGeometry.bounds.height,
                metrics
            );
        }

        for (const [id, view] of this.rowViews) {
            if (!visible.has(id)) {
                this.root.removeChild(view.root);
                view.destroy();
                this.rowViews.delete(id);
            }
        }
    }

    private paint(name: ColorName) {
        return themePaint(name, this.theme);
    }

    private updateChrome(
        card: BoardCard,
        geometry: BoardCardGeometry,
        lod: BoardLod,
        selected: boolean,
        hovered: boolean,
        firstHighlighted: boolean
    ): void {
        const width = geometry.bounds.width;
        const height = geometry.bounds.height;
        const metrics = cardMetrics(card, lod);
        this.shadow.position.set(-16, -16);
        this.shadow.width = width + 32;
        this.shadow.height = height + 32;
        this.body
            .clear()
            .roundRect(0, 0, width, height, themeRadius(this.theme, 'radius-md'))
            .fill(this.paint('surface-card'));
        this.chrome.begin();
        const g = this.chrome.graphics;

        for (const branch of geometry.branches ?? []) {
            const x = branch.bounds.x - geometry.bounds.x;
            const y = branch.bounds.y - geometry.bounds.y;
            const center = y + branch.bounds.height / 2;

            for (let dash = width; dash < x; dash += 8) {
                g.moveTo(dash, center)
                    .lineTo(Math.min(dash + 4, x), center)
                    .stroke({ ...this.paint('edge'), width: 1.5 });
            }

            g.roundRect(x, y, branch.bounds.width, branch.bounds.height, 14).fill(
                this.paint('surface-card')
            );
            const row = this.rowModels.get(branch.memberId);
            const name = card.display === 'summary' ? '' : (row?.name ?? '');
            const status =
                branch.totalItems === null ? 'Not loaded' : `${branch.totalItems} fields`;

            if (name) {
                this.chrome.label(`branch-name:${branch.memberId}`, {
                    text: name,
                    x: x + 12,
                    y: center,
                    role: 'subheadline',
                    maxWidth: 72,
                });
            }

            this.chrome.label(`branch-count:${branch.memberId}`, {
                text: status,
                x:
                    x +
                    12 +
                    (name
                        ? Math.min(72, this.metrics.width(name, 'subheadline')) + 8
                        : 0),
                y: center,
                role: 'subheadline',
                ink: 'label-secondary',
                maxWidth:
                    branch.bounds.width -
                    Math.min(72, this.metrics.width(name, 'subheadline')) -
                    74,
            });
            this.chrome.label(`branch-action:${branch.memberId}`, {
                text:
                    branch.state === 'loading'
                        ? 'Loading…'
                        : branch.state === 'failed'
                          ? 'Retry'
                          : 'Expand',
                x: x + branch.bounds.width - 12,
                y: center,
                role: 'subheadline',
                ink: 'accent-ink',
                right: true,
            });
        }

        if (lod === 'overview' && selected) {
            g.roundRect(0, 0, width, height, themeRadius(this.theme, 'radius-md')).fill(
                this.paint('accent-fill')
            );
        } else if (selected || hovered) {
            g.roundRect(
                4,
                4,
                width - 8,
                Math.min(metrics.header, height - 8),
                themeRadius(this.theme, 'radius-sm')
            ).fill(this.paint(selected ? 'accent-fill' : 'fill-hover'));
        }

        if (
            !card.rows.length &&
            card.rowWindow.state === 'loading' &&
            lod !== 'overview'
        ) {
            for (let index = 0; index < 3; index += 1) {
                g.roundRect(
                    10,
                    10 + index * 12,
                    [width * 0.65, width * 0.48, width * 0.58][index],
                    6,
                    3
                ).fill(this.paint('fill-control'));
            }

            this.chrome.end();

            return;
        }

        const summary = card.display === 'summary' && lod !== 'overview';
        const overview = lod === 'overview';

        if (summary) {
            if (!card.rows.length && card.rowWindow.state === 'loading') {
                for (let index = 0; index < 3; index += 1) {
                    g.roundRect(
                        10,
                        10 + index * 12,
                        [width * 0.65, width * 0.48, width * 0.58][index],
                        6,
                        3
                    ).fill(this.paint('fill-control'));
                }
            } else if (!card.rows.length) {
                this.chrome.label('summary-title', {
                    text: card.title,
                    x: 14,
                    y: 18,
                    maxWidth:
                        width -
                        28 -
                        (card.subtitle
                            ? this.metrics.width(card.subtitle, 'mono') + 10
                            : 0),
                });

                if (card.subtitle) {
                    this.chrome.label('summary-subtitle', {
                        text: card.subtitle,
                        x: width - 14,
                        y: 18,
                        role: 'mono',
                        right: true,
                        ink:
                            card.rowWindow.state === 'notRequested'
                                ? 'accent-ink'
                                : 'label-secondary',
                        maxWidth: width * 0.58,
                    });
                }
            }

            this.chrome.end();

            return;
        }

        const compactHeader = lod === 'working' && width <= 190;
        const subtitleRole = card.subtitleEmphasis ? 'subheadline' : 'mono';

        if (
            !compactHeader &&
            !selected &&
            !hovered &&
            !firstHighlighted &&
            showSeparator(0, geometry.rows.length + 1, new Set()) &&
            !geometry.regions.some(region => region.target.kind === 'boundary')
        ) {
            g.rect(24, 4 + metrics.header - 1, width - 48, 1).fill(
                this.paint('separator')
            );
        }

        const titleX = overview ? 10 : compactHeader ? 14 : 36;
        const headerCenter = 4 + metrics.header / 2;
        this.chrome.label('title', {
            text: card.title,
            x: titleX,
            y: overview ? 18 : headerCenter,
            role: 'headline',
            maxWidth:
                width -
                titleX -
                (card.suggested
                    ? this.metrics.width('Suggested', 'subheadline') + 24
                    : card.subtitle && !overview
                      ? this.metrics.width(
                            card.subtitle,
                            subtitleRole,
                            !!card.subtitleEmphasis
                        ) + 24
                      : overview
                        ? 10
                        : 14),
        });

        if (overview) {
            this.chrome.label('count', {
                text: card.subtitle ?? String(card.rowWindow.totalItems),
                x: 10,
                y: 39,
                role: 'subheadline',
                ink: 'label-secondary',
                maxWidth: width - 20,
            });
            this.chrome.end();

            return;
        }

        if (!compactHeader) {
            this.chrome.label('glyph', {
                text: '<>',
                x: 14,
                y: headerCenter,
                role: 'mono',
                ink: 'label-tertiary',
            });
        }

        if (card.suggested) {
            this.chrome.label('suggested', {
                text: 'Suggested',
                x: width - 14,
                y: headerCenter,
                role: 'subheadline',
                ink: 'label-secondary',
                italic: true,
                right: true,
            });
        } else if (card.subtitle) {
            this.chrome.label('subtitle', {
                text: card.subtitle,
                x: width - 14,
                y: headerCenter,
                role: subtitleRole,
                ink: card.subtitleEmphasis ? 'label' : 'label-secondary',
                bold: card.subtitleEmphasis,
                right: true,
                maxWidth: width * 0.42,
            });
        }

        if (card.namespace) {
            const x = titleX + this.metrics.width(card.title, 'headline') + 8;
            this.chrome.label('namespace', {
                text: card.namespace,
                x,
                y: headerCenter,
                role: 'mono',
                ink: 'label-secondary',
                maxWidth: Math.max(
                    0,
                    width -
                        x -
                        14 -
                        (card.subtitle
                            ? this.metrics.width(
                                  card.subtitle,
                                  subtitleRole,
                                  !!card.subtitleEmphasis
                              ) + 8
                            : 0)
                ),
            });
        }

        let y = 4 + metrics.header;

        if (card.variants?.length) {
            const regionWidth = (width - 16) / card.variants.length;
            g.roundRect(8, y + 6, width - 16, 34, 17).fill(this.paint('fill-control'));

            card.variants.forEach((variant, index) => {
                const x = 8 + index * regionWidth;
                const active = variant.variantId === card.activeVariantId;

                if (active) {
                    g.roundRect(x + 3, y + 9, regionWidth - 6, 28, 14).fill(
                        this.paint('surface-card')
                    );
                }

                const count = `${variant.count}/${variant.total}`;
                const titleWidth = this.metrics.width(
                    variant.title,
                    'subheadline',
                    active
                );
                const countWidth = this.metrics.width(count, 'subheadline');
                const start = x + (regionWidth - titleWidth - countWidth - 8) / 2;
                this.chrome.label(`variant:${variant.variantId}`, {
                    text: variant.title,
                    x: start,
                    y: y + 23,
                    role: 'subheadline',
                    bold: active,
                    maxWidth: regionWidth - countWidth - 20,
                });
                this.chrome.label(`variant-count:${variant.variantId}`, {
                    text: count,
                    x: start + titleWidth + 8,
                    y: y + 23,
                    role: 'subheadline',
                    ink: 'label-secondary',
                });
            });

            y += CARD.variant;
        }

        const boundaries = geometry.regions.filter(
            region => region.target.kind === 'boundary'
        );

        if (boundaries.length) {
            g.roundRect(
                4,
                y,
                width - 8,
                metrics.boundary,
                themeRadius(this.theme, 'radius-sm')
            ).fill(this.paint('fill-hover'));
            this.chrome.label('boundary', {
                text: `↑ ${boundaries.length} linked ${boundaries.length === 1 ? 'row' : 'rows'} outside window`,
                x: 14,
                y: y + metrics.boundary / 2,
                role: 'subheadline',
                ink: 'label-secondary',
                maxWidth: width - 28,
            });
            y += metrics.boundary;
        }

        if (!card.collapsed) {
            y +=
                geometry.rowViewport?.bounds.height ?? geometry.rows.length * metrics.row;
        }

        const rowViewport = geometry.rowViewport;

        const scrollbar = rowScrollbar(card, geometry);

        if (scrollbar) {
            g.roundRect(
                width - 7,
                scrollbar.trackTop,
                3,
                scrollbar.trackHeight,
                1.5
            ).fill(this.paint('fill-control'));
            g.roundRect(
                width - 7,
                scrollbar.thumbTop,
                3,
                scrollbar.thumbHeight,
                1.5
            ).fill(this.paint('label-tertiary'));
        }

        if (needsFooter(card, lod) || card.collapsed) {
            const state = card.rowWindow.state;
            const count = card.rowWindow.loadedItems ?? card.rows.length;
            const bounded =
                !!rowViewport && rowViewport.totalItems > geometry.rows.length;
            const first =
                card.rowWindow.firstIndex === undefined && !bounded
                    ? undefined
                    : (card.rowWindow.firstIndex ?? 0) + (rowViewport?.firstIndex ?? 0);
            const prefix =
                first === undefined
                    ? `${count} of ${card.rowWindow.totalItems}`
                    : `Rows ${first + 1}–${first + geometry.rows.length} of ${card.rowWindow.totalItems}`;
            const footer = footerHeight(card, lod);
            const label =
                state === 'loading'
                    ? 'Loading…'
                    : state === 'failed'
                      ? (card.rowWindow.error ?? 'Page did not load')
                      : card.collapsed || state === 'notRequested'
                        ? `${card.rowWindow.totalItems} fields`
                        : card.rowWindow.totalItems === 0 && state === 'complete'
                          ? 'No members'
                          : prefix;
            this.chrome.label('footer', {
                text: label,
                x: 14,
                y: y + (!card.rows.length && state === 'complete' ? 14 : footer / 2),
                role: 'subheadline',
                ink: state === 'failed' ? 'danger' : 'label-secondary',
                maxWidth: width - 96,
            });

            if (state === 'loading' && !card.rows.length) {
                for (let index = 0; index < 3; index += 1) {
                    g.roundRect(
                        14,
                        y + 4 + index * 7,
                        [width * 0.45, width * 0.3, width * 0.38][index],
                        4,
                        2
                    ).fill(this.paint('fill-control'));
                }
            } else if (
                state === 'failed' ||
                card.rowWindow.hasMore ||
                card.collapsed ||
                state === 'notRequested'
            ) {
                const remaining = Math.max(0, card.rowWindow.totalItems - count);
                this.chrome.label('more', {
                    text:
                        state === 'failed'
                            ? 'Retry'
                            : card.collapsed || state === 'notRequested'
                              ? 'Expand'
                              : remaining < 50
                                ? `Show ${remaining} more`
                                : 'Next 50',
                    x: width - 14,
                    y: y + footer / 2,
                    role: 'subheadline',
                    ink: 'accent-ink',
                    right: true,
                    bold: true,
                });
            }

            if (!card.rows.length && state === 'complete') {
                this.chrome.label('empty-add', {
                    text: '+ Add from palette',
                    x: 14,
                    y: y + footer - 12,
                    role: 'subheadline',
                    ink: 'accent-ink',
                });
            }

            y += footer;
        }

        if (card.note) {
            this.chrome.label('note', {
                text: card.note,
                x: 14,
                y: y + metrics.note / 2,
                role: 'subheadline',
                ink: card.note.startsWith('+') ? 'accent-ink' : 'label-secondary',
                maxWidth: width - 28,
            });
        }

        this.chrome.end();
    }

    setResolution(resolution: number): void {
        this.resolution = resolution;
        this.chrome.setResolution(resolution);

        for (const row of this.rowViews.values()) {
            row.setResolution(resolution);
        }
    }

    get textCount(): number {
        let count = this.chrome.textCount;

        for (const row of this.rowViews.values()) {
            count += row.textCount;
        }

        return count;
    }

    destroy(): void {
        this.root.destroy({ children: true });
        this.rowViews.clear();
    }
}
