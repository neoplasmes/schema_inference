import { Container, type Texture } from 'pixi.js';
import type { BoardCard, BoardLod, BoardModel, BoardSelection } from '../../model';
import type { BoardCardGeometry, DragPreview, Rectangle } from '../contracts';
import type { LabelMetrics } from '../../text';
import type { ResolvedBoardTheme } from '../../theme';
import type { SceneGeometry } from '../scene';
import { CardView } from './cardView';

type CardInputs = {
    card: BoardCard;
    geometry: BoardCardGeometry;
    selection: string | null | undefined;
    hover: string | null | undefined;
    dragged: string | undefined;
    lod: BoardLod;
};

export class CardLayer {
    readonly cardLayer = new Container();
    private readonly cardViews = new Map<string, CardView>();
    private readonly cardInputs = new Map<string, CardInputs>();
    private readonly query: {
        bounds: Rectangle;
        geometry: BoardCardGeometry;
    }[] = [];
    private readonly queryIds = new Set<string>();
    private readonly visibleCards: BoardCardGeometry[] = [];
    private readonly visibleCardIds = new Set<string>();

    constructor(
        private readonly geometry: SceneGeometry,
        private readonly metrics: LabelMetrics,
        private readonly shadow: Texture,
        private readonly theme: ResolvedBoardTheme,
        private textResolution: number
    ) {}

    sync(
        bounds: Rectangle,
        model: BoardModel,
        hover: BoardSelection | null,
        dragPreview: DragPreview | null,
        selectedTargets: ReadonlySet<string>
    ): void {
        const lod = this.geometry.lod;
        this.geometry.cardIndex.queryInto(bounds, this.query, this.queryIds);
        this.visibleCards.length = 0;
        this.visibleCardIds.clear();

        for (const entry of this.query) {
            const geometry = entry.geometry;
            let index = this.visibleCards.length;
            this.visibleCards.push(geometry);

            while (
                index > 0 &&
                this.geometry.order.get(this.visibleCards[index - 1].blockId)! >
                    this.geometry.order.get(geometry.blockId)!
            ) {
                this.visibleCards[index] = this.visibleCards[index - 1];
                index -= 1;
            }

            this.visibleCards[index] = geometry;
            this.visibleCardIds.add(geometry.blockId);
        }

        for (const [id, view] of this.cardViews) {
            if (!this.visibleCardIds.has(id)) {
                this.cardLayer.removeChild(view.root);
                view.destroy();
                this.cardViews.delete(id);
                this.cardInputs.delete(id);
            }
        }

        let cardOrder = 0;

        for (const geometry of this.visibleCards) {
            const card = this.geometry.models.get(geometry.blockId)!;
            let view = this.cardViews.get(geometry.blockId);

            if (!view) {
                view = new CardView(
                    this.metrics,
                    this.shadow,
                    this.textResolution,
                    this.theme
                );
                this.cardViews.set(geometry.blockId, view);
                this.cardLayer.addChild(view.root);
            }

            const selection =
                selectedTargets.has(card.blockId) &&
                model.selection?.blockId !== card.blockId
                    ? this.geometry.headerSelections.get(card.blockId)!
                    : model.selection;
            const selectedMember =
                selection?.blockId === card.blockId ? selection.memberId : undefined;
            const hoveredMember =
                hover?.blockId === card.blockId ? hover.memberId : undefined;
            const draggedMember =
                dragPreview?.blockId === card.blockId ? dragPreview.memberId : undefined;
            let input = this.cardInputs.get(card.blockId);

            if (
                !input ||
                input.card !== card ||
                input.geometry !== geometry ||
                input.selection !== selectedMember ||
                input.hover !== hoveredMember ||
                input.dragged !== draggedMember ||
                input.lod !== lod
            ) {
                view.sync(card, geometry, lod, selection, hover, draggedMember);

                if (!input) {
                    input = {
                        card,
                        geometry,
                        selection: selectedMember,
                        hover: hoveredMember,
                        dragged: draggedMember,
                        lod,
                    };
                    this.cardInputs.set(card.blockId, input);
                } else {
                    input.card = card;
                    input.geometry = geometry;
                    input.selection = selectedMember;
                    input.hover = hoveredMember;
                    input.dragged = draggedMember;
                    input.lod = lod;
                }
            }

            if (this.cardLayer.children[cardOrder] !== view.root) {
                this.cardLayer.setChildIndex(view.root, cardOrder);
            }

            cardOrder += 1;
        }
    }

    setResolution(resolution: number): void {
        this.textResolution = resolution;

        for (const view of this.cardViews.values()) {
            view.setResolution(resolution);
        }
    }

    get visibleCount(): number {
        return this.cardViews.size;
    }
    get textCount(): number {
        let count = 0;

        for (const view of this.cardViews.values()) {
            count += view.textCount;
        }

        return count;
    }

    clear(): void {
        this.cardViews.clear();
        this.cardInputs.clear();
        this.query.length = 0;
        this.queryIds.clear();
        this.visibleCards.length = 0;
        this.visibleCardIds.clear();
    }
}
