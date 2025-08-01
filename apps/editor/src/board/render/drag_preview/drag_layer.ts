import { Container, Graphics, type Texture } from 'pixi.js';
import type { BoardViewport } from '../../model';
import type { BoardHit, DragPreview } from '../contracts';
import type { LabelMetrics } from '../../text';
import { paint, type ResolvedBoardTheme } from '../../theme';
import type { SceneGeometry } from '../scene';
import { DragGhostView } from './drag_ghost_view';

export class DragLayer {
    readonly root = new Container();
    preview: DragPreview | null = null;
    private readonly overlay = new Graphics();
    private drop: BoardHit | null = null;
    private dragGhost: DragGhostView | null = null;
    private dirty = true;
    private geometryRevision = -1;

    constructor(
        private readonly geometry: SceneGeometry,
        private readonly metrics: LabelMetrics,
        private readonly shadow: Texture,
        private readonly theme: ResolvedBoardTheme
    ) {
        this.root.addChild(this.overlay);
    }

    setPreview(preview: DragPreview | null): void {
        this.preview = preview;
        this.dirty = true;
    }
    setDropTarget(target: BoardHit | null): void {
        this.drop = target;
        this.dirty = true;
    }
    viewportChanged(): void {
        this.dirty ||= !!this.drop;
    }

    sync(viewport: BoardViewport, textResolution: number): void {
        if (this.geometryRevision !== this.geometry.revision) {
            this.geometryRevision = this.geometry.revision;
            this.dirty = true;
        }
        if (!this.dirty) {
            return;
        }
        const dragPreview = this.preview;
        this.overlay.clear();

        if (this.drop) {
            const card = this.geometry.cards.get(this.drop.blockId);
            const region = card?.regions.find(
                region => JSON.stringify(region.target) === JSON.stringify(this.drop)
            );

            if (region) {
                this.overlay
                    .moveTo(region.bounds.x + 10, region.bounds.y)
                    .lineTo(region.bounds.x + region.bounds.width - 10, region.bounds.y)
                    .stroke({ ...paint('accent', this.theme), width: 2 / viewport.zoom });
            }
        }

        if (dragPreview) {
            const preview = dragPreview;
            const source = this.geometry.models
                .get(preview.blockId)
                ?.rows.find(row => row.memberId === preview.memberId);

            const sourceBounds = this.geometry.cards
                .get(preview.blockId)
                ?.rows.find(row => row.memberId === preview.memberId)?.bounds;

            if (source && sourceBounds) {
                if (!this.dragGhost) {
                    this.dragGhost = new DragGhostView(
                        this.metrics,
                        this.shadow,
                        textResolution
                    );
                    this.root.addChild(this.dragGhost.root);
                }

                this.dragGhost.update(
                    source,
                    sourceBounds,
                    preview.position,
                    textResolution
                );
            } else if (this.dragGhost) {
                this.dragGhost.root.visible = false;
            }
        } else if (this.dragGhost) {
            this.dragGhost.root.visible = false;
        }

        this.dirty = false;
    }

    get textCount(): number {
        return Number(this.dragGhost?.root.visible ?? false) * 2;
    }

    clear(): void {
        this.drop = null;
        this.preview = null;
        this.dragGhost = null;
    }
}
