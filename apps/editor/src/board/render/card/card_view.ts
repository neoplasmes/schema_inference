import { Container, type Texture } from 'pixi.js';
import type { BoardCard, BoardRow, BoardLod, BoardSelection } from '../../model';
import type { BoardCardGeometry } from '../contracts';
import { cardMetrics, showSeparator } from '../../layout';
import type { LabelMetrics } from '../../text';
import type { ResolvedBoardTheme } from '../../theme';
import { CardChrome } from '../chrome';
import { RowView } from '../row';

export class CardView {
    readonly root = new Container();
    private readonly chrome: CardChrome;
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
        theme: ResolvedBoardTheme
    ) {
        this.chrome = new CardChrome(metrics, shadow, resolution, theme);
        this.root.eventMode = 'none';
        this.root.addChild(this.chrome.root);
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
            this.chrome.update(
                card,
                geometry,
                lod,
                selectedHeader,
                hoveredHeader,
                firstHighlighted,
                this.rowModels
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
                    showSeparator(
                        index + 1,
                        geometry.rows.length + 1,
                        highlighted,
                        card.metrics?.separators === true
                    ),
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
