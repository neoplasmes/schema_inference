import { Container, Graphics } from 'pixi.js';
import type { BoardConnection, BoardModel } from '../../model';
import type { BoardConnectionGeometry, Rectangle } from '../contracts';
import type { LabelMetrics } from '../../text';
import { RetainedLabel } from '../../text';
import { paint, type ResolvedBoardTheme } from '../../theme';
import type { SceneGeometry } from '../scene';
import { drawConnection } from './edges';

type EdgeGroup = {
    geometry: BoardConnectionGeometry;
    connection: BoardConnection;
    selected: boolean;
    dashed: boolean;
    count: number;
};

export class EdgeLayer {
    readonly selectedTargets = new Set<string>();
    redraws = 0;
    private readonly normalEdges = new Graphics();
    private readonly unloadedEdges = new Graphics();
    private readonly selectedEdges = new Graphics();
    private readonly badgeLayer = new Container();
    private readonly badgeViews = new Map<
        string,
        {
            label: RetainedLabel;
            badge: Graphics;
        }
    >();
    private readonly edgeGroups = new Map<string, EdgeGroup>();
    private readonly edgeGroupsById = new Map<string, EdgeGroup>();
    private readonly visibleGroups = new Set<EdgeGroup>();
    private readonly drawnGroups = new Set<EdgeGroup>();
    private readonly visibleBadgeIds = new Set<string>();
    private readonly query: BoardConnectionGeometry[] = [];
    private readonly queryIds = new Set<string>();
    private groupsDirty = true;
    private edgeRevision = 0;
    private renderedEdgeRevision = -1;
    private geometryRevision = -1;

    constructor(
        private readonly geometry: SceneGeometry,
        private readonly metrics: LabelMetrics,
        private readonly theme: ResolvedBoardTheme,
        private textResolution: number
    ) {}

    mount(world: Container): void {
        world.addChild(
            this.normalEdges,
            this.unloadedEdges,
            this.selectedEdges,
            this.badgeLayer
        );
    }

    sync(bounds: Rectangle, model: BoardModel, textResolution: number): void {
        this.textResolution = textResolution;

        if (this.geometry.revision !== this.geometryRevision) {
            this.geometryRevision = this.geometry.revision;
            this.groupsDirty = true;
            this.edgeRevision += 1;
        }

        this.geometry.edgeIndex.queryInto(bounds, this.query, this.queryIds);
        this.visibleGroups.clear();

        if (this.groupsDirty) {
            this.rebuildGroups(model);
        }

        for (const geometry of this.query) {
            const group = this.edgeGroupsById.get(geometry.id);

            if (group) {
                this.visibleGroups.add(group);
            }
        }

        this.draw();
    }

    updateSelection(model: BoardModel): void {
        this.selectedTargets.clear();
        this.groupsDirty = true;
        this.edgeRevision += 1;

        for (const edge of model.connections) {
            if (
                edge.state === 'selected' ||
                (model.selection?.blockId === edge.sourceBlockId &&
                    model.selection.memberId === edge.sourceMemberId)
            ) {
                this.selectedTargets.add(edge.targetBlockId);
            }
        }
    }

    private rebuildGroups(model: BoardModel): void {
        this.edgeGroups.clear();
        this.edgeGroupsById.clear();

        for (const geometry of this.geometry.edges.values()) {
            const connection = this.geometry.connections.get(geometry.id)!;
            const key =
                this.geometry.lod === 'overview'
                    ? JSON.stringify([
                          connection.sourceBlockId,
                          connection.targetBlockId,
                          connection.kind,
                      ])
                    : geometry.id;
            const selected =
                connection.state === 'selected' ||
                (model.selection?.blockId === connection.sourceBlockId &&
                    model.selection.memberId === connection.sourceMemberId);
            const dashed =
                connection.state === 'unloaded' ||
                connection.kind === 'preview' ||
                geometry.sourceHidden;
            let group = this.edgeGroups.get(key);

            if (group) {
                group.count += 1;
                group.selected ||= selected;
                group.dashed ||= dashed;
            } else {
                group = {
                    geometry,
                    connection,
                    selected,
                    dashed,
                    count: 1,
                };
                this.edgeGroups.set(key, group);
            }

            this.edgeGroupsById.set(geometry.id, group);
        }

        this.groupsDirty = false;
    }

    private draw(): void {
        let changed =
            this.edgeRevision !== this.renderedEdgeRevision ||
            this.visibleGroups.size !== this.drawnGroups.size;

        if (!changed) {
            for (const group of this.visibleGroups) {
                if (!this.drawnGroups.has(group)) {
                    changed = true;
                    break;
                }
            }
        }

        if (!changed || !this.metrics) {
            return;
        }

        this.normalEdges.clear();
        this.unloadedEdges.clear();
        this.selectedEdges.clear();
        this.visibleBadgeIds.clear();
        this.drawnGroups.clear();

        for (const group of this.visibleGroups) {
            const { geometry, selected, dashed, count } = group;
            const layer = selected
                ? this.selectedEdges
                : dashed
                  ? this.unloadedEdges
                  : this.normalEdges;
            drawConnection(layer, geometry, selected, dashed, this.theme, count, false);
            this.drawnGroups.add(group);

            if (count > 1) {
                this.visibleBadgeIds.add(geometry.id);
                let entry = this.badgeViews.get(geometry.id);

                if (!entry) {
                    entry = {
                        label: new RetainedLabel(this.metrics, this.textResolution),
                        badge: new Graphics(),
                    };
                    this.badgeViews.set(geometry.id, entry);
                    this.badgeLayer.addChild(entry.badge, entry.label.view);
                }

                const x = (geometry.source.x + geometry.target.x) / 2;
                const y = (geometry.source.y + geometry.target.y) / 2;
                entry.badge
                    .clear()
                    .roundRect(x - 13, y - 9, 26, 18, 9)
                    .fill(paint('surface-card', this.theme));
                entry.label.update({
                    text: `×${count}`,
                    x: x - 9,
                    y,
                    role: 'footnote',
                });
            }
        }

        for (const [id, entry] of this.badgeViews) {
            if (!this.visibleBadgeIds.has(id)) {
                entry.badge.removeFromParent();
                entry.badge.destroy();
                entry.label.view.removeFromParent();
                entry.label.view.destroy();
                this.badgeViews.delete(id);
            }
        }

        this.renderedEdgeRevision = this.edgeRevision;
        this.redraws += 1;
    }

    get visibleCount(): number {
        return this.visibleGroups.size;
    }
    get textCount(): number {
        return this.badgeViews.size;
    }

    clear(): void {
        this.badgeViews.clear();
        this.edgeGroups.clear();
        this.edgeGroupsById.clear();
        this.query.length = 0;
        this.queryIds.clear();
        this.visibleGroups.clear();
        this.drawnGroups.clear();
        this.visibleBadgeIds.clear();
        this.selectedTargets.clear();
    }
}
