import { Graphics, NineSliceSprite, type Texture } from 'pixi.js';
import type { BoardCard, BoardRow, BoardLod } from '../../model';
import type { BoardCardGeometry } from '../contracts';
import {
    CARD,
    cardMetrics,
    needsFooter,
    footerHeight,
    rowScrollbar,
    showSeparator,
} from '../../layout';
import type { LabelMetrics } from '../../text';
import { themeRadius, type ResolvedBoardTheme } from '../../theme';
import { LabelGroup } from '../labels';

export class CardChrome extends LabelGroup {
    private readonly body = new Graphics();
    private readonly shadow: NineSliceSprite;

    constructor(
        metrics: LabelMetrics,
        shadow: Texture,
        resolution: number,
        private readonly theme: ResolvedBoardTheme
    ) {
        super(metrics, resolution);
        this.shadow = new NineSliceSprite({
            texture: shadow,
            leftWidth: 28,
            rightWidth: 28,
            topHeight: 28,
            bottomHeight: 28,
        });
        this.root.addChildAt(this.body, 0);
        this.root.addChildAt(this.shadow, 0);
    }

    update(
        card: BoardCard,
        geometry: BoardCardGeometry,
        lod: BoardLod,
        selected: boolean,
        hovered: boolean,
        firstHighlighted: boolean,
        rows: ReadonlyMap<string, BoardRow>
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
        this.begin();
        const g = this.graphics;

        for (const branch of geometry.branches ?? []) {
            const x = branch.bounds.x - geometry.bounds.x;
            const y = branch.bounds.y - geometry.bounds.y;
            const center = y + branch.bounds.height / 2;

            for (let dash = width; dash < x; dash += 8) {
                g.moveTo(dash, center)
                    .lineTo(Math.min(dash + 4, x), center)
                    .stroke({
                        ...this.paint('edge'),
                        width: 1.5,
                    });
            }

            g.roundRect(x, y, branch.bounds.width, branch.bounds.height, 14).fill(
                this.paint('surface-card')
            );
            const row = rows.get(branch.memberId);
            const name = card.display === 'summary' ? '' : (row?.name ?? '');
            const status =
                branch.totalItems === null ? 'Not loaded' : `${branch.totalItems} fields`;

            if (name) {
                this.label(`branch-name:${branch.memberId}`, {
                    text: name,
                    x: x + 12,
                    y: center,
                    role: 'subheadline',
                    maxWidth: 72,
                });
            }

            this.label(`branch-count:${branch.memberId}`, {
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
            this.label(`branch-action:${branch.memberId}`, {
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

        const loadingStub = !card.rows.length && card.rowWindow.state === 'loading';

        if (lod === 'overview' && selected && !loadingStub) {
            g.roundRect(0, 0, width, height, themeRadius(this.theme, 'radius-md')).fill(
                this.paint('accent-fill')
            );
        } else if ((selected || hovered) && !loadingStub) {
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
                    [
                        width * 0.65,
                        width * 0.48,
                        width * 0.58,
                    ][index],
                    6,
                    3
                ).fill(this.paint('fill-control'));
            }

            this.end();

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
                        [
                            width * 0.65,
                            width * 0.48,
                            width * 0.58,
                        ][index],
                        6,
                        3
                    ).fill(this.paint('fill-control'));
                }
            } else if (!card.rows.length) {
                this.label('summary-title', {
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
                    this.label('summary-subtitle', {
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

            this.end();

            return;
        }

        const compactHeader = lod === 'working' && width <= 190;
        const plainHeader = card.metrics?.headerLayout === 'plain';
        const subtitleRole = card.subtitleEmphasis ? 'subheadline' : 'mono';

        if (
            metrics.separators &&
            (!compactHeader || card.metrics?.separators === true) &&
            !selected &&
            !hovered &&
            !firstHighlighted &&
            showSeparator(
                0,
                geometry.rows.length + 1,
                new Set(),
                card.metrics?.separators === true
            ) &&
            !geometry.regions.some(region => region.target.kind === 'boundary')
        ) {
            g.rect(24, 4 + metrics.header - 1, width - 48, 1).fill(
                this.paint('separator')
            );
        }

        const titleX = overview ? 10 : compactHeader || plainHeader ? 14 : 36;
        const headerCenter = 4 + metrics.header / 2;
        this.label('title', {
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
            this.label('count', {
                text: card.subtitle ?? String(card.rowWindow.totalItems),
                x: 10,
                y: 39,
                role: 'subheadline',
                ink: 'label-secondary',
                maxWidth: width - 20,
            });
            this.end();

            return;
        }

        if (!compactHeader && !plainHeader) {
            this.label('glyph', {
                text: '<>',
                x: 14,
                y: headerCenter,
                role: 'mono',
                ink: 'label-tertiary',
            });
        }

        if (card.suggested) {
            this.label('suggested', {
                text: 'Suggested',
                x: width - 14,
                y: headerCenter,
                role: 'subheadline',
                ink: 'label-secondary',
                italic: true,
                right: true,
            });
        } else if (card.subtitle) {
            this.label('subtitle', {
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
            this.label('namespace', {
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
                this.label(`variant:${variant.variantId}`, {
                    text: variant.title,
                    x: start,
                    y: y + 23,
                    role: 'subheadline',
                    bold: active,
                    maxWidth: regionWidth - countWidth - 20,
                });
                this.label(`variant-count:${variant.variantId}`, {
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
            this.label('boundary', {
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
                    : `Rows ${first + 1}-${first + geometry.rows.length} of ${card.rowWindow.totalItems}`;
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
            this.label('footer', {
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
                        [
                            width * 0.45,
                            width * 0.3,
                            width * 0.38,
                        ][index],
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
                this.label('more', {
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
                this.label('empty-add', {
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
            this.label('note', {
                text: card.note,
                x: 14,
                y: y + metrics.note / 2,
                role: 'subheadline',
                ink: card.note.startsWith('+') ? 'accent-ink' : 'label-secondary',
                maxWidth: width - 28,
            });
        }

        this.end();
    }
}
