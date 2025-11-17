import type { BoardLod, BoardModel, BoardSelection, BoardViewport } from '../../model';
import { diffBoardModels } from '../../model';
import { levelOfDetail, normalizeViewport } from '../../viewport';
import type { BoardRenderer, BoardRendererOptions } from '../contracts';
import { CardLayer } from '../card';
import { EdgeLayer } from '../edges';
import { DragLayer } from '../dragPreview';
import { SceneGeometry } from './sceneGeometry';
import { SceneLifecycle, type SceneResources } from './sceneLifecycle';

const EMPTY_MODEL: BoardModel = {
    version: 0,
    cards: [],
    connections: [],
    selection: null,
    state: 'empty',
};

export function createBoardRenderer(options: BoardRendererOptions): BoardRenderer {
    const lifecycle = new SceneLifecycle(options);
    let model = EMPTY_MODEL;
    let viewport: BoardViewport = {
        x: 0,
        y: 0,
        zoom: 1,
    };
    let hover: BoardSelection | null = null;
    let destroyed = false;
    let resources: SceneResources | null = null;
    let cards: CardLayer | null = null;
    let edges: EdgeLayer | null = null;
    let drag: DragLayer | null = null;
    let textResolution = lifecycle.resolution;
    let zoomTimer: ReturnType<typeof setTimeout> | null = null;
    let statusDirty = true;
    const bounds = {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
    };
    const geometry = new SceneGeometry(
        (text, role, bold) => resources!.metrics.width(text, role, bold),
        invalidate
    );
    const stats = {
        renderedFrames: 0,
        visibleCards: 0,
        visibleConnections: 0,
        textObjects: 0,
        lod: 'working' as BoardLod,
        edgeGraphics: 3,
        edgeLayerRedraws: 0,
    };

    function sync(): void {
        if (destroyed || !resources || !cards || !edges || !drag) {
            return;
        }

        resources.world.position.set(viewport.x, viewport.y);
        resources.world.scale.set(viewport.zoom);
        bounds.x = (-120 - viewport.x) / viewport.zoom;
        bounds.y = (-120 - viewport.y) / viewport.zoom;
        bounds.width = (lifecycle.width + 240) / viewport.zoom;
        bounds.height = (lifecycle.height + 240) / viewport.zoom;
        cards.sync(bounds, model, hover, drag.preview, edges.selectedTargets);
        edges.sync(bounds, model, textResolution);
        drag.sync(viewport, textResolution);

        if (statusDirty) {
            resources.status.update(
                model.state,
                model.cards.length,
                lifecycle.width,
                lifecycle.height
            );
            statusDirty = false;
        }

        lifecycle.render();
        stats.renderedFrames += 1;
        stats.visibleCards = cards.visibleCount;
        stats.visibleConnections = edges.visibleCount;
        stats.textObjects =
            cards.textCount +
            edges.textCount +
            drag.textCount +
            Number(resources.status.view.visible);
        stats.lod = geometry.lod;
        stats.edgeLayerRedraws = edges.redraws;
    }

    function invalidate(): void {
        lifecycle.schedule(sync);
    }

    const ready = lifecycle.initialize(next => {
        resources = next;
        cards = new CardLayer(
            geometry,
            next.metrics,
            next.shadow,
            lifecycle.theme,
            textResolution
        );
        edges = new EdgeLayer(geometry, next.metrics, lifecycle.theme, textResolution);
        drag = new DragLayer(geometry, next.metrics, next.shadow, lifecycle.theme);
        edges.mount(next.world);
        next.world.addChild(cards.cardLayer, drag.root);
        edges.updateSelection(model);
        geometry.rebuild(model, model.diagnosticLod ?? levelOfDetail(viewport.zoom));
        sync();
    });

    return {
        ready,
        setModel(next): void {
            if (destroyed) {
                return;
            }

            const diff = diffBoardModels(model, next);
            const nextLod = next.diagnosticLod ?? levelOfDetail(viewport.zoom);
            model = next;
            geometry.setModel(next);
            statusDirty = true;
            edges?.updateSelection(model);

            if (
                resources &&
                (diff.addedCards.length ||
                    diff.changedCards.length ||
                    diff.removedCards.length ||
                    diff.changedConnections.length ||
                    diff.removedConnections.length ||
                    nextLod !== geometry.lod)
            ) {
                geometry.rebuild(model, nextLod);
            }

            if (resources && diff.selectionChanged && next.selection?.memberId) {
                geometry.revealMember(next.selection.blockId, next.selection.memberId);
            }

            invalidate();
        },
        setHover(next): void {
            if (hover?.blockId === next?.blockId && hover?.memberId === next?.memberId) {
                return;
            }

            hover = next;
            invalidate();
        },
        setViewport(next): void {
            if (destroyed) {
                return;
            }

            viewport = normalizeViewport(next);
            drag?.viewportChanged();
            const nextLod = model.diagnosticLod ?? levelOfDetail(viewport.zoom);

            if (resources && nextLod !== geometry.lod) {
                geometry.rebuild(model, nextLod);
            }

            if (zoomTimer !== null) {
                clearTimeout(zoomTimer);
            }

            zoomTimer = setTimeout(() => {
                zoomTimer = null;
                const nextResolution = Math.min(
                    2,
                    Math.max(1, lifecycle.resolution * viewport.zoom)
                );

                if (!destroyed && textResolution !== nextResolution) {
                    textResolution = nextResolution;
                    cards?.setResolution(textResolution);
                    invalidate();
                }
            }, 160);
            invalidate();
        },
        resize(width, height): void {
            if (lifecycle.resize(width, height)) {
                statusDirty = true;
                invalidate();
            }
        },
        getGeometry: () => geometry.getGeometry(),
        hitTest: point => geometry.hitTest(point),
        queryCards: bounds => geometry.queryCards(bounds),
        previewCardPosition(blockId, position): void {
            if (!destroyed) {
                geometry.previewCardPosition(blockId, position);
            }
        },
        scrollRows: (blockId, delta) => geometry.scrollRows(blockId, delta),
        revealMember: (blockId, memberId) => geometry.revealMember(blockId, memberId),
        previewMemberDrag(next): void {
            drag?.setPreview(next);
            invalidate();
        },
        setDropTarget(next): void {
            drag?.setDropTarget(next);
            invalidate();
        },
        getStats: () => ({
            ...stats,
        }),
        invalidate,
        destroy(): void {
            if (destroyed) {
                return;
            }

            destroyed = true;

            if (zoomTimer !== null) {
                clearTimeout(zoomTimer);
                zoomTimer = null;
            }

            lifecycle.destroy();
            cards?.clear();
            edges?.clear();
            drag?.clear();
            geometry.clear();
            resources = null;
            model = EMPTY_MODEL;
            hover = null;
            stats.visibleCards = 0;
            stats.visibleConnections = 0;
            stats.textObjects = 0;
        },
    };
}
