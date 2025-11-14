import type {
    BoardCard,
    BoardConnection,
    BoardModel,
    BoardLod,
    BoardSelection,
    Point,
} from '../../model';
import type {
    BoardCardGeometry,
    BoardConnectionGeometry,
    BoardGeometry,
    BoardHit,
    Rectangle,
} from '../contracts';
import {
    aggregateBounds,
    connectionGeometry,
    createCardGeometry,
    EMPTY_GEOMETRY,
    hiddenSourceMembers,
    rowWindowFor,
    cardMetrics,
    layoutCards,
    SpatialIndex,
    hitTestCards,
    type RowMeasure,
} from '../../layout';

export class SceneGeometry {
    readonly cardIndex = new SpatialIndex<{
        bounds: Rectangle;
        geometry: BoardCardGeometry;
    }>();
    readonly edgeIndex = new SpatialIndex<BoardConnectionGeometry>();
    readonly cards = new Map<string, BoardCardGeometry>();
    readonly edges = new Map<string, BoardConnectionGeometry>();
    readonly headerSelections = new Map<string, BoardSelection>();
    models = new Map<string, BoardCard>();
    order = new Map<string, number>();
    connections = new Map<string, BoardConnection>();
    lod: BoardLod = 'working';
    revision = 0;
    private readonly previews = new Map<string, Point>();
    private readonly rowAnchors = new Map<string, string>();
    private readonly rowWheel = new Map<string, number>();
    private readonly adjacency = new Map<string, Set<string>>();
    private hidden = new Map<string, readonly string[]>();
    private layout = new Map<string, Point>();
    private model: BoardModel = {
        version: 0,
        cards: [],
        connections: [],
        selection: null,
        state: 'empty',
    };
    private geometryDirty = false;
    private snapshot: BoardGeometry = EMPTY_GEOMETRY;

    constructor(
        private readonly measure: RowMeasure,
        private readonly changed: () => void
    ) {}

    setModel(model: BoardModel): void {
        this.model = model;
    }

    rebuild(model: BoardModel, lod: BoardLod): void {
        this.model = model;
        this.lod = lod;
        this.models = new Map(
            this.model.cards.map(card => [
                card.blockId,
                card,
            ])
        );
        this.headerSelections.clear();

        for (const card of this.model.cards) {
            this.headerSelections.set(card.blockId, {
                blockId: card.blockId,
                memberId: null,
            });
        }
        this.order = new Map(
            this.model.cards.map((card, index) => [
                card.blockId,
                index,
            ])
        );
        this.connections = new Map(
            this.model.connections.map(connection => [
                connection.id,
                connection,
            ])
        );
        const visibleRows = new Map(
            this.model.cards.map(card => [
                card.blockId,
                new Set(
                    rowWindowFor(card, this.lod, this.rowOffset(card)).rows.map(
                        row => row.memberId
                    )
                ),
            ])
        );
        this.hidden = hiddenSourceMembers(this.model, visibleRows);

        for (const blockId of this.rowAnchors.keys()) {
            if (!this.models.has(blockId)) {
                this.rowAnchors.delete(blockId);
                this.rowWheel.delete(blockId);
            }
        }
        this.layout = layoutCards(this.model, this.lod, this.hidden);
        this.cards.clear();
        this.edges.clear();
        this.cardIndex.clear();
        this.edgeIndex.clear();
        this.adjacency.clear();

        for (const card of this.model.cards) {
            const geometry = createCardGeometry(
                card,
                this.previews.get(card.blockId) ?? this.layout.get(card.blockId)!,
                this.lod,
                this.hidden.get(card.blockId),
                this.rowOffset(card),
                this.measure
            );
            this.cards.set(card.blockId, geometry);
            this.cardIndex.set(card.blockId, {
                bounds: geometry.visibilityBounds ?? geometry.bounds,
                geometry,
            });
        }

        for (const connection of this.model.connections) {
            for (const blockId of [
                connection.sourceBlockId,
                connection.targetBlockId,
            ]) {
                let ids = this.adjacency.get(blockId);

                if (!ids) {
                    ids = new Set();
                    this.adjacency.set(blockId, ids);
                }

                ids.add(connection.id);
            }

            this.updateEdge(connection.id);
        }

        this.geometryDirty = true;
    }

    private rowOffset(card: BoardCard): number {
        const memberId = this.rowAnchors.get(card.blockId);

        return memberId
            ? Math.max(
                  0,
                  card.rows.findIndex(row => row.memberId === memberId)
              )
            : 0;
    }

    private updateCardWindow(card: BoardCard): void {
        const rows = new Set(
            rowWindowFor(card, this.lod, this.rowOffset(card)).rows.map(
                row => row.memberId
            )
        );
        const outside = new Set<string>();

        for (const id of this.adjacency.get(card.blockId) ?? []) {
            const connection = this.connections.get(id);

            if (
                connection?.sourceBlockId === card.blockId &&
                !rows.has(connection.sourceMemberId)
            ) {
                outside.add(connection.sourceMemberId);
            }
        }

        this.hidden.set(card.blockId, [
            ...outside,
        ]);
        const geometry = createCardGeometry(
            card,
            this.previews.get(card.blockId) ?? this.layout.get(card.blockId)!,
            this.lod,
            this.hidden.get(card.blockId),
            this.rowOffset(card),
            this.measure
        );
        this.cards.set(card.blockId, geometry);
        this.cardIndex.set(card.blockId, {
            bounds: geometry.visibilityBounds ?? geometry.bounds,
            geometry,
        });

        for (const id of this.adjacency.get(card.blockId) ?? []) {
            this.updateEdge(id);
        }

        this.geometryDirty = true;
        this.changed();
    }

    revealMember(blockId: string, memberId: string): boolean {
        const card = this.models.get(blockId);
        const index = card?.rows.findIndex(row => row.memberId === memberId) ?? -1;

        if (!card || card.collapsed || index < 0 || this.lod === 'overview') {
            return false;
        }

        const window = rowWindowFor(card, this.lod, this.rowOffset(card));

        if (index >= window.firstIndex && index < window.endIndex) {
            return true;
        }

        let first =
            index < window.firstIndex
                ? index
                : Math.max(0, index - window.rows.length + 1);

        while (first < index && rowWindowFor(card, this.lod, first).endIndex <= index) {
            first += 1;
        }

        this.rowAnchors.set(blockId, card.rows[first].memberId);
        this.rowWheel.delete(blockId);
        this.updateCardWindow(card);

        return true;
    }

    private updateEdge(id: string): void {
        this.revision += 1;
        const connection = this.connections.get(id);
        const source = connection && this.cards.get(connection.sourceBlockId);
        const target = connection && this.cards.get(connection.targetBlockId);

        if (!connection || !source || !target) {
            this.edges.delete(id);
            this.edgeIndex.delete(id);

            return;
        }

        const geometry = connectionGeometry(
            id,
            connection.sourceMemberId,
            source,
            target,
            this.lod
        );
        this.edges.set(id, geometry);
        this.edgeIndex.set(id, geometry);
    }

    getGeometry(): BoardGeometry {
        if (this.geometryDirty) {
            const allCards = [
                ...this.cards.values(),
            ];
            this.snapshot = {
                version: this.model.version,
                cards: allCards,
                connections: [
                    ...this.edges.values(),
                ],
                bounds: aggregateBounds(allCards),
            };
            this.geometryDirty = false;
        }

        return this.snapshot;
    }
    hitTest(point: Point): BoardHit | null {
        const candidates = this.cardIndex
            .query({
                ...point,
                width: 0,
                height: 0,
            })
            .map(entry => entry.geometry)
            .sort((a, b) => this.order.get(a.blockId)! - this.order.get(b.blockId)!);

        return hitTestCards(candidates, point);
    }
    queryCards(bounds: Rectangle): readonly BoardCardGeometry[] {
        return this.cardIndex.query(bounds).map(entry => entry.geometry);
    }
    previewCardPosition(blockId: string, position: Point | null): void {
        const card = this.models.get(blockId);

        if (!card) {
            return;
        }

        if (position) {
            this.previews.set(blockId, position);
        } else {
            this.previews.delete(blockId);
        }

        const geometry = createCardGeometry(
            card,
            position ?? this.layout.get(blockId)!,
            this.lod,
            this.hidden.get(blockId),
            this.rowOffset(card),
            this.measure
        );
        this.cards.set(blockId, geometry);
        this.cardIndex.set(blockId, {
            bounds: geometry.visibilityBounds ?? geometry.bounds,
            geometry,
        });

        for (const id of this.adjacency.get(blockId) ?? []) {
            this.updateEdge(id);
        }

        this.geometryDirty = true;
        this.changed();
    }
    scrollRows(blockId: string, delta: number): boolean {
        const card = this.models.get(blockId);

        if (!card || card.collapsed || this.lod === 'overview') {
            return false;
        }

        const window = rowWindowFor(card, this.lod, this.rowOffset(card));

        if (window.rows.length === card.rows.length) {
            return false;
        }

        const accumulated = (this.rowWheel.get(blockId) ?? 0) + delta;
        const rowHeight = cardMetrics(card, this.lod).row;
        const steps = Math.trunc(accumulated / rowHeight);
        this.rowWheel.set(blockId, accumulated - steps * rowHeight);

        if (steps) {
            const first = rowWindowFor(
                card,
                this.lod,
                window.firstIndex + steps
            ).firstIndex;
            this.rowAnchors.set(blockId, card.rows[first].memberId);
            this.updateCardWindow(card);
        }

        return true;
    }

    clear(): void {
        this.cards.clear();
        this.edges.clear();
        this.cardIndex.clear();
        this.edgeIndex.clear();
        this.models.clear();
        this.order.clear();
        this.connections.clear();
        this.headerSelections.clear();
        this.previews.clear();
        this.rowAnchors.clear();
        this.rowWheel.clear();
        this.adjacency.clear();
        this.layout.clear();
        this.hidden.clear();
        this.model = {
            version: 0,
            cards: [],
            connections: [],
            selection: null,
            state: 'empty',
        };
        this.snapshot = EMPTY_GEOMETRY;
    }
}
