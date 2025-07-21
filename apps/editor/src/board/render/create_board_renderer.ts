import { Application, Container, Graphics, Sprite, type Texture } from 'pixi.js';
import type {
    BoardCard,
    BoardConnection,
    BoardLod,
    BoardModel,
    BoardSelection,
    BoardViewport,
    Point,
} from '../model/types';
import type {
    BoardCardGeometry,
    BoardConnectionGeometry,
    BoardGeometry,
    BoardHit,
    BoardRenderer,
    BoardRendererOptions,
    Rectangle,
} from './types';
import {
    aggregateBounds,
    connectionGeometry,
    createCardGeometry,
    EMPTY_GEOMETRY,
    hiddenSourceMembers,
    rowWindowFor,
    cardMetrics,
} from '../layout/card_geometry';
import { layoutCards } from '../layout/tree_layout';
import { SpatialIndex } from '../layout/spatial_index';
import { hitTestCards } from '../layout/hit_test';
import { levelOfDetail, normalizeViewport } from '../viewport/coordinates';
import { diffBoardModels } from '../model/diff';
import { LabelMetrics, RetainedLabel } from '../text/labels';
import { CardView } from './card_view';
import { createBackground, createShadow } from './background';
import { drawConnection } from './edges';
import { paint } from './colors';
import { resolveTheme } from './theme';

const EMPTY_MODEL: BoardModel = {
    version: 0,
    cards: [],
    connections: [],
    selection: null,
    state: 'empty',
};

export function createBoardRenderer(options: BoardRendererOptions): BoardRenderer {
    const theme = resolveTheme(options.theme);
    const app = new Application();
    const world = new Container();
    const normalEdges = new Graphics();
    const unloadedEdges = new Graphics();
    const selectedEdges = new Graphics();
    const badgeLayer = new Container();
    const cardLayer = new Container();
    const overlay = new Graphics();
    const cardIndex = new SpatialIndex<{
        bounds: Rectangle;
        geometry: BoardCardGeometry;
    }>();
    const edgeIndex = new SpatialIndex<BoardConnectionGeometry>();
    const cards = new Map<string, BoardCardGeometry>();
    const edges = new Map<string, BoardConnectionGeometry>();
    const cardViews = new Map<string, CardView>();
    type EdgeGroup = {
        geometry: BoardConnectionGeometry;
        connection: BoardConnection;
        selected: boolean;
        dashed: boolean;
        count: number;
    };
    type CardInputs = {
        card: BoardCard;
        geometry: BoardCardGeometry;
        selection: string | null | undefined;
        hover: string | null | undefined;
        dragged: string | undefined;
        lod: BoardLod;
    };
    const badgeViews = new Map<string, { label: RetainedLabel; badge: Graphics }>();
    const cardInputs = new Map<string, CardInputs>();
    const headerSelections = new Map<string, BoardSelection>();
    const edgeGroups = new Map<string, EdgeGroup>();
    const edgeGroupsById = new Map<string, EdgeGroup>();
    const cardQuery: { bounds: Rectangle; geometry: BoardCardGeometry }[] = [];
    const edgeQuery: BoardConnectionGeometry[] = [];
    const cardQueryIds = new Set<string>();
    const edgeQueryIds = new Set<string>();
    const visibleCards: BoardCardGeometry[] = [];
    const visibleGroups = new Set<EdgeGroup>();
    const drawnGroups = new Set<EdgeGroup>();
    const visibleCardIds = new Set<string>();
    const visibleBadgeIds = new Set<string>();
    const renderBounds = { x: 0, y: 0, width: 0, height: 0 };
    let groupsDirty = true;
    let edgeRevision = 0;
    let renderedEdgeRevision = -1;
    let overlayDirty = true;
    const previews = new Map<string, Point>();
    const rowAnchors = new Map<string, string>();
    const rowWheel = new Map<string, number>();
    const adjacency = new Map<string, Set<string>>();
    let models = new Map<string, BoardCard>();
    let order = new Map<string, number>();
    let connections = new Map<string, BoardConnection>();
    const selectedTargets = new Set<string>();
    let hidden = new Map<string, readonly string[]>();
    let layout = new Map<string, Point>();
    let model = EMPTY_MODEL;
    let viewport: BoardViewport = { x: 0, y: 0, zoom: 1 };
    let hover: BoardSelection | null = null;
    let drop: BoardHit | null = null;
    let dragPreview: Readonly<{
        blockId: string;
        memberId: string;
        position: Point;
    }> | null = null;
    let dragLabel: RetainedLabel | null = null;
    let width = Math.max(1, options.width ?? options.container.clientWidth);
    let height = Math.max(1, options.height ?? options.container.clientHeight);
    const resolution = Math.min(
        2,
        Math.max(1, options.resolution ?? window.devicePixelRatio ?? 1)
    );
    let textResolution = resolution;
    let lod: BoardLod = 'working';
    let initialized = false;
    let applicationInitialized = false;
    let applicationDestroyed = false;
    let destroyed = false;
    let frame: number | null = null;
    let zoomTimer: ReturnType<typeof setTimeout> | null = null;
    let background: Sprite | null = null;
    let shadow: Texture | null = null;
    let metrics: LabelMetrics | null = null;
    let snapshot: BoardGeometry = EMPTY_GEOMETRY;
    let geometryDirty = false;
    const stats = {
        renderedFrames: 0,
        visibleCards: 0,
        visibleConnections: 0,
        textObjects: 0,
        lod: lod as BoardLod,
        edgeGraphics: 3,
        edgeLayerRedraws: 0,
    };

    function rebuildGeometry(): void {
        lod = model.diagnosticLod ?? levelOfDetail(viewport.zoom);
        models = new Map(model.cards.map(card => [card.blockId, card]));
        headerSelections.clear();

        for (const card of model.cards) {
            headerSelections.set(card.blockId, { blockId: card.blockId, memberId: null });
        }
        order = new Map(model.cards.map((card, index) => [card.blockId, index]));
        connections = new Map(
            model.connections.map(connection => [connection.id, connection])
        );
        const visibleRows = new Map(
            model.cards.map(card => [
                card.blockId,
                new Set(
                    rowWindowFor(card, lod, rowOffset(card)).rows.map(row => row.memberId)
                ),
            ])
        );
        hidden = hiddenSourceMembers(model, visibleRows);

        for (const blockId of rowAnchors.keys()) {
            if (!models.has(blockId)) {
                rowAnchors.delete(blockId);
                rowWheel.delete(blockId);
            }
        }
        layout = layoutCards(model, lod, hidden);
        cards.clear();
        edges.clear();
        cardIndex.clear();
        edgeIndex.clear();
        adjacency.clear();

        for (const card of model.cards) {
            const geometry = createCardGeometry(
                card,
                previews.get(card.blockId) ?? layout.get(card.blockId)!,
                lod,
                hidden.get(card.blockId),
                rowOffset(card)
            );
            cards.set(card.blockId, geometry);
            cardIndex.set(card.blockId, {
                bounds: geometry.visibilityBounds ?? geometry.bounds,
                geometry,
            });
        }

        for (const connection of model.connections) {
            for (const blockId of [connection.sourceBlockId, connection.targetBlockId]) {
                let ids = adjacency.get(blockId);

                if (!ids) {
                    ids = new Set();
                    adjacency.set(blockId, ids);
                }

                ids.add(connection.id);
            }

            updateEdge(connection.id);
        }

        geometryDirty = true;
    }

    function rowOffset(card: BoardCard): number {
        const memberId = rowAnchors.get(card.blockId);

        return memberId
            ? Math.max(
                  0,
                  card.rows.findIndex(row => row.memberId === memberId)
              )
            : 0;
    }

    function updateCardWindow(card: BoardCard): void {
        const rows = new Set(
            rowWindowFor(card, lod, rowOffset(card)).rows.map(row => row.memberId)
        );
        const outside = new Set<string>();

        for (const id of adjacency.get(card.blockId) ?? []) {
            const connection = connections.get(id);

            if (
                connection?.sourceBlockId === card.blockId &&
                !rows.has(connection.sourceMemberId)
            ) {
                outside.add(connection.sourceMemberId);
            }
        }

        hidden.set(card.blockId, [...outside]);
        const geometry = createCardGeometry(
            card,
            previews.get(card.blockId) ?? layout.get(card.blockId)!,
            lod,
            hidden.get(card.blockId),
            rowOffset(card)
        );
        cards.set(card.blockId, geometry);
        cardIndex.set(card.blockId, {
            bounds: geometry.visibilityBounds ?? geometry.bounds,
            geometry,
        });

        for (const id of adjacency.get(card.blockId) ?? []) {
            updateEdge(id);
        }

        geometryDirty = true;
        invalidate();
    }

    function revealMember(blockId: string, memberId: string): boolean {
        const card = models.get(blockId);
        const index = card?.rows.findIndex(row => row.memberId === memberId) ?? -1;

        if (!card || card.collapsed || index < 0 || lod === 'overview') {
            return false;
        }

        const window = rowWindowFor(card, lod, rowOffset(card));

        if (index >= window.firstIndex && index < window.endIndex) {
            return true;
        }

        let first =
            index < window.firstIndex
                ? index
                : Math.max(0, index - window.rows.length + 1);

        while (first < index && rowWindowFor(card, lod, first).endIndex <= index) {
            first += 1;
        }

        rowAnchors.set(blockId, card.rows[first].memberId);
        rowWheel.delete(blockId);
        updateCardWindow(card);

        return true;
    }

    function updateSelectedTargets(): void {
        selectedTargets.clear();
        groupsDirty = true;
        edgeRevision += 1;

        for (const edge of model.connections) {
            if (
                edge.state === 'selected' ||
                (model.selection?.blockId === edge.sourceBlockId &&
                    model.selection.memberId === edge.sourceMemberId)
            ) {
                selectedTargets.add(edge.targetBlockId);
            }
        }
    }

    function updateEdge(id: string): void {
        groupsDirty = true;
        edgeRevision += 1;
        overlayDirty = true;
        const connection = connections.get(id);
        const source = connection && cards.get(connection.sourceBlockId);
        const target = connection && cards.get(connection.targetBlockId);

        if (!connection || !source || !target) {
            edges.delete(id);
            edgeIndex.delete(id);

            return;
        }

        const geometry = connectionGeometry(
            id,
            connection.sourceMemberId,
            source,
            target,
            lod
        );
        edges.set(id, geometry);
        edgeIndex.set(id, geometry);
    }

    function rebuildEdgeGroups(): void {
        edgeGroups.clear();
        edgeGroupsById.clear();

        for (const geometry of edges.values()) {
            const connection = connections.get(geometry.id)!;
            const key =
                lod === 'overview'
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
            let group = edgeGroups.get(key);

            if (group) {
                group.count += 1;
                group.selected ||= selected;
                group.dashed ||= dashed;
            } else {
                group = { geometry, connection, selected, dashed, count: 1 };
                edgeGroups.set(key, group);
            }

            edgeGroupsById.set(geometry.id, group);
        }

        groupsDirty = false;
    }

    function syncEdges(): void {
        let changed =
            edgeRevision !== renderedEdgeRevision ||
            visibleGroups.size !== drawnGroups.size;

        if (!changed) {
            for (const group of visibleGroups) {
                if (!drawnGroups.has(group)) {
                    changed = true;
                    break;
                }
            }
        }

        if (!changed || !metrics) {
            return;
        }

        normalEdges.clear();
        unloadedEdges.clear();
        selectedEdges.clear();
        visibleBadgeIds.clear();
        drawnGroups.clear();

        for (const group of visibleGroups) {
            const { geometry, selected, dashed, count } = group;
            const layer = selected ? selectedEdges : dashed ? unloadedEdges : normalEdges;
            drawConnection(layer, geometry, selected, dashed, theme, count, false);
            drawnGroups.add(group);

            if (count > 1) {
                visibleBadgeIds.add(geometry.id);
                let entry = badgeViews.get(geometry.id);

                if (!entry) {
                    entry = {
                        label: new RetainedLabel(metrics, textResolution),
                        badge: new Graphics(),
                    };
                    badgeViews.set(geometry.id, entry);
                    badgeLayer.addChild(entry.badge, entry.label.view);
                }

                const x = (geometry.source.x + geometry.target.x) / 2;
                const y = (geometry.source.y + geometry.target.y) / 2;
                entry.badge
                    .clear()
                    .roundRect(x - 13, y - 9, 26, 18, 9)
                    .fill(paint('surface-card', theme));
                entry.label.update({ text: `×${count}`, x: x - 9, y, role: 'footnote' });
            }
        }

        for (const [id, entry] of badgeViews) {
            if (!visibleBadgeIds.has(id)) {
                entry.badge.removeFromParent();
                entry.badge.destroy();
                entry.label.view.removeFromParent();
                entry.label.view.destroy();
                badgeViews.delete(id);
            }
        }

        renderedEdgeRevision = edgeRevision;
        stats.edgeLayerRedraws += 1;
    }

    function sync(): void {
        if (destroyed || !initialized || !metrics || !shadow) {
            return;
        }

        world.position.set(viewport.x, viewport.y);
        world.scale.set(viewport.zoom);
        renderBounds.x = (-120 - viewport.x) / viewport.zoom;
        renderBounds.y = (-120 - viewport.y) / viewport.zoom;
        renderBounds.width = (width + 240) / viewport.zoom;
        renderBounds.height = (height + 240) / viewport.zoom;
        cardIndex.queryInto(renderBounds, cardQuery, cardQueryIds);
        edgeIndex.queryInto(renderBounds, edgeQuery, edgeQueryIds);
        visibleCards.length = 0;
        visibleCardIds.clear();
        visibleGroups.clear();

        for (const entry of cardQuery) {
            const geometry = entry.geometry;
            let index = visibleCards.length;
            visibleCards.push(geometry);

            while (
                index > 0 &&
                order.get(visibleCards[index - 1].blockId)! > order.get(geometry.blockId)!
            ) {
                visibleCards[index] = visibleCards[index - 1];
                index -= 1;
            }

            visibleCards[index] = geometry;
            visibleCardIds.add(geometry.blockId);
        }

        if (groupsDirty) {
            rebuildEdgeGroups();
        }

        for (const geometry of edgeQuery) {
            const group = edgeGroupsById.get(geometry.id);

            if (group) {
                visibleGroups.add(group);
            }
        }

        for (const [id, view] of cardViews) {
            if (!visibleCardIds.has(id)) {
                cardLayer.removeChild(view.root);
                view.destroy();
                cardViews.delete(id);
                cardInputs.delete(id);
            }
        }

        let cardOrder = 0;

        for (const geometry of visibleCards) {
            const card = models.get(geometry.blockId)!;
            let view = cardViews.get(geometry.blockId);

            if (!view) {
                view = new CardView(metrics, shadow, textResolution, theme);
                cardViews.set(geometry.blockId, view);
                cardLayer.addChild(view.root);
            }

            const selection =
                selectedTargets.has(card.blockId) &&
                model.selection?.blockId !== card.blockId
                    ? headerSelections.get(card.blockId)!
                    : model.selection;
            const selectedMember =
                selection?.blockId === card.blockId ? selection.memberId : undefined;
            const hoveredMember =
                hover?.blockId === card.blockId ? hover.memberId : undefined;
            const draggedMember =
                dragPreview?.blockId === card.blockId ? dragPreview.memberId : undefined;
            let input = cardInputs.get(card.blockId);

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
                    cardInputs.set(card.blockId, input);
                } else {
                    input.card = card;
                    input.geometry = geometry;
                    input.selection = selectedMember;
                    input.hover = hoveredMember;
                    input.dragged = draggedMember;
                    input.lod = lod;
                }
            }

            if (cardLayer.children[cardOrder] !== view.root) {
                cardLayer.setChildIndex(view.root, cardOrder);
            }

            cardOrder += 1;
        }

        syncEdges();

        if (overlayDirty) {
            overlay.clear();

            if (drop) {
                const card = cards.get(drop.blockId);
                const region = card?.regions.find(
                    region => JSON.stringify(region.target) === JSON.stringify(drop)
                );

                if (region) {
                    overlay
                        .moveTo(region.bounds.x + 10, region.bounds.y)
                        .lineTo(
                            region.bounds.x + region.bounds.width - 10,
                            region.bounds.y
                        )
                        .stroke({ ...paint('accent', theme), width: 2 / viewport.zoom });
                }
            }

            if (dragPreview) {
                const preview = dragPreview;
                const source = models
                    .get(preview.blockId)
                    ?.rows.find(row => row.memberId === preview.memberId);

                if (source) {
                    const x = preview.position.x + 12;
                    const y = preview.position.y + 12;
                    const ghostWidth = Math.min(
                        240,
                        Math.max(100, metrics.width(source.name, 'body') + 40)
                    );
                    overlay
                        .roundRect(x, y, ghostWidth, 32, 12)
                        .fill(paint('surface-sidebar', theme));

                    if (!dragLabel) {
                        dragLabel = new RetainedLabel(metrics, textResolution);
                        world.addChild(dragLabel.view);
                    }

                    dragLabel.update({
                        text: source.name,
                        x: x + 14,
                        y: y + 16,
                        maxWidth: ghostWidth - 28,
                    });
                }
            } else if (dragLabel) {
                dragLabel.view.removeFromParent();
                dragLabel.view.destroy();
                dragLabel = null;
            }

            overlayDirty = false;
        }

        app.render();
        let textObjects = Number(!!dragLabel) + badgeViews.size;

        for (const view of cardViews.values()) {
            textObjects += view.textCount;
        }

        stats.renderedFrames += 1;
        stats.visibleCards = cardViews.size;
        stats.visibleConnections = visibleGroups.size;
        stats.textObjects = textObjects;
        stats.lod = lod;
    }

    function invalidate(): void {
        if (destroyed || !initialized || frame !== null) {
            return;
        }

        frame = requestAnimationFrame(() => {
            frame = null;
            sync();
        });
    }

    function replaceBackground(): void {
        if (!initialized || options.background === false) {
            return;
        }

        const texture = createBackground(width, height, resolution, theme);

        if (background) {
            const previous = background.texture;
            background.texture = texture;
            previous.destroy(true);
        } else {
            background = new Sprite(texture);
            app.stage.addChildAt(background, 0);
        }

        background.width = width;
        background.height = height;
    }

    function destroyApplication(): void {
        if (applicationInitialized && !applicationDestroyed) {
            applicationDestroyed = true;
            app.destroy(true, { children: true });
        }
    }

    const ready = (async () => {
        await app.init({
            width,
            height,
            antialias: true,
            resolution,
            autoDensity: true,
            autoStart: false,
            sharedTicker: false,
            preference: 'webgl',
            backgroundAlpha: 0,
        });
        applicationInitialized = true;

        if (destroyed) {
            destroyApplication();

            return;
        }

        await document.fonts?.ready;

        if (destroyed) {
            destroyApplication();

            return;
        }

        initialized = true;
        app.canvas.style.display = 'block';
        app.canvas.style.width = '100%';
        app.canvas.style.height = '100%';
        options.container.appendChild(app.canvas);
        app.stage.eventMode = 'none';
        world.addChild(
            normalEdges,
            unloadedEdges,
            selectedEdges,
            badgeLayer,
            cardLayer,
            overlay
        );
        app.stage.addChild(world);
        metrics = new LabelMetrics(theme);
        shadow = createShadow(theme);
        app.renderer.resize(width, height);
        replaceBackground();
        rebuildGeometry();
        sync();
    })();

    return {
        ready,
        setModel(next): void {
            if (destroyed) {
                return;
            }

            const diff = diffBoardModels(model, next);
            const nextLod = next.diagnosticLod ?? levelOfDetail(viewport.zoom);
            model = next;
            updateSelectedTargets();

            if (
                initialized &&
                (diff.addedCards.length ||
                    diff.changedCards.length ||
                    diff.removedCards.length ||
                    diff.changedConnections.length ||
                    diff.removedConnections.length ||
                    nextLod !== lod)
            ) {
                rebuildGeometry();
            }

            if (initialized && diff.selectionChanged && next.selection?.memberId) {
                revealMember(next.selection.blockId, next.selection.memberId);
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
            overlayDirty ||= !!drop;
            const nextLod = model.diagnosticLod ?? levelOfDetail(viewport.zoom);

            if (initialized && nextLod !== lod) {
                rebuildGeometry();
            }

            if (zoomTimer !== null) {
                clearTimeout(zoomTimer);
            }

            zoomTimer = setTimeout(() => {
                zoomTimer = null;
                const nextResolution = Math.min(
                    2,
                    Math.max(1, resolution * viewport.zoom)
                );

                if (!destroyed && textResolution !== nextResolution) {
                    textResolution = nextResolution;

                    for (const view of cardViews.values()) {
                        view.setResolution(textResolution);
                    }

                    invalidate();
                }
            }, 160);

            invalidate();
        },
        resize(nextWidth, nextHeight): void {
            const w = Math.max(1, nextWidth);
            const h = Math.max(1, nextHeight);

            if (destroyed || (width === w && height === h)) {
                return;
            }

            width = w;
            height = h;

            if (initialized) {
                app.renderer.resize(width, height);
                replaceBackground();
            }

            invalidate();
        },
        getGeometry(): BoardGeometry {
            if (geometryDirty) {
                const allCards = [...cards.values()];
                snapshot = {
                    version: model.version,
                    cards: allCards,
                    connections: [...edges.values()],
                    bounds: aggregateBounds(allCards),
                };
                geometryDirty = false;
            }

            return snapshot;
        },
        hitTest(point): BoardHit | null {
            const candidates = cardIndex
                .query({ ...point, width: 0, height: 0 })
                .map(entry => entry.geometry)
                .sort((a, b) => order.get(a.blockId)! - order.get(b.blockId)!);

            return hitTestCards(candidates, point);
        },
        queryCards(bounds): readonly BoardCardGeometry[] {
            return cardIndex.query(bounds).map(entry => entry.geometry);
        },
        previewCardPosition(blockId, position): void {
            const card = models.get(blockId);

            if (!card || destroyed) {
                return;
            }

            if (position) {
                previews.set(blockId, position);
            } else {
                previews.delete(blockId);
            }

            const geometry = createCardGeometry(
                card,
                position ?? layout.get(blockId)!,
                lod,
                hidden.get(blockId),
                rowOffset(card)
            );
            cards.set(blockId, geometry);
            cardIndex.set(blockId, {
                bounds: geometry.visibilityBounds ?? geometry.bounds,
                geometry,
            });

            for (const id of adjacency.get(blockId) ?? []) {
                updateEdge(id);
            }

            geometryDirty = true;
            invalidate();
        },
        scrollRows(blockId, delta): boolean {
            const card = models.get(blockId);

            if (!card || card.collapsed || lod === 'overview') {
                return false;
            }

            const window = rowWindowFor(card, lod, rowOffset(card));

            if (window.rows.length === card.rows.length) {
                return false;
            }

            const accumulated = (rowWheel.get(blockId) ?? 0) + delta;
            const rowHeight = cardMetrics(card, lod).row;
            const steps = Math.trunc(accumulated / rowHeight);
            rowWheel.set(blockId, accumulated - steps * rowHeight);

            if (steps) {
                const first = rowWindowFor(
                    card,
                    lod,
                    window.firstIndex + steps
                ).firstIndex;
                rowAnchors.set(blockId, card.rows[first].memberId);
                updateCardWindow(card);
            }

            return true;
        },
        revealMember,
        previewMemberDrag(next): void {
            dragPreview = next;
            overlayDirty = true;
            invalidate();
        },
        setDropTarget(next): void {
            drop = next;
            overlayDirty = true;
            invalidate();
        },
        getStats: () => ({ ...stats }),
        invalidate,
        destroy(): void {
            if (destroyed) {
                return;
            }

            destroyed = true;

            if (frame !== null) {
                cancelAnimationFrame(frame);
                frame = null;
            }

            if (zoomTimer !== null) {
                clearTimeout(zoomTimer);
                zoomTimer = null;
            }

            const backgroundTexture = background?.texture;
            destroyApplication();
            backgroundTexture?.destroy(true);
            shadow?.destroy(true);

            metrics?.clear();
            cardViews.clear();
            badgeViews.clear();
            cardInputs.clear();
            headerSelections.clear();
            edgeGroups.clear();
            edgeGroupsById.clear();
            cardQuery.length = 0;
            edgeQuery.length = 0;
            visibleCards.length = 0;
            cardQueryIds.clear();
            edgeQueryIds.clear();
            visibleGroups.clear();
            drawnGroups.clear();
            visibleCardIds.clear();
            visibleBadgeIds.clear();
            cards.clear();
            edges.clear();
            cardIndex.clear();
            edgeIndex.clear();
            models.clear();
            order.clear();
            connections.clear();
            previews.clear();
            rowAnchors.clear();
            rowWheel.clear();
            adjacency.clear();
            selectedTargets.clear();
            layout.clear();
            hidden.clear();
            model = EMPTY_MODEL;
            snapshot = EMPTY_GEOMETRY;
            hover = null;
            drop = null;
            dragPreview = null;
            dragLabel = null;
            stats.visibleCards = 0;
            stats.visibleConnections = 0;
            stats.textObjects = 0;
        },
    };
}
