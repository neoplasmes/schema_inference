import type {
    BoardEventHandler,
    BoardEventMap,
    BoardModel,
    BoardViewport,
    Point,
} from '../model';
import type { BoardGeometry, BoardRenderStats } from '../render';
import { createBoardEvents } from '../model';
import { createBoardRenderer } from '../render';
import { createBoardInteraction } from '../interaction';
import { fitBounds, normalizeViewport, zoomAt } from '../viewport';
import { resolveTheme, type BoardTheme } from '../theme';

export type SchemaBoardOptions = Readonly<{
    container: HTMLElement;
    model?: BoardModel;
    viewport?: BoardViewport;
    resolution?: number;
    theme?: Partial<BoardTheme>;
    background?: boolean;
}>;

export type SchemaBoard = {
    readonly ready: Promise<void>;
    setModel(model: BoardModel): void;
    on<K extends keyof BoardEventMap>(
        event: K,
        handler: BoardEventHandler<K>
    ): () => void;
    readonly viewport: {
        get(): BoardViewport;
        set(viewport: BoardViewport): void;
        fitAll(padding?: number): void;
        zoomTo(zoomOrBlockId: number | string, anchor?: Point): void;
    };
    arrange(): void;
    getGeometry(): BoardGeometry;
    getStats(): BoardRenderStats;
    destroy(): void;
};

/** Each board owns its renderer, event subscriptions, camera and gesture lifecycle. */
export function createSchemaBoard(options: SchemaBoardOptions): SchemaBoard {
    const { container } = options;
    const events = createBoardEvents();
    let model: BoardModel = options.model ?? {
        version: 0,
        cards: [],
        connections: [],
        state: 'empty',
        selection: null,
    };
    let sourceModel = model;
    const arrangedPositions = new Map<string, Point>();
    let viewport = normalizeViewport(options.viewport ?? { x: 0, y: 0, zoom: 1 });
    let destroyed = false;
    const renderer = createBoardRenderer({
        container,
        resolution: options.resolution,
        theme: options.theme,
        background: options.background,
    });
    renderer.setModel(model);
    renderer.setViewport(viewport);

    function setViewport(next: BoardViewport): void {
        if (destroyed) {
            return;
        }

        viewport = normalizeViewport(next);
        renderer.setViewport(viewport);
    }

    function emit<K extends keyof BoardEventMap>(
        event: K,
        payload: BoardEventMap[K]
    ): void {
        if (event === 'move') {
            const movement = payload as BoardEventMap['move'];

            if (movement.kind === 'card') {
                arrangedPositions.delete(movement.blockId);
            }
        }

        events.emit(event, payload);
    }

    const interaction = createBoardInteraction({
        container,
        renderer,
        getModel: () => model,
        getViewport: () => viewport,
        setViewport,
        emit,
        theme: resolveTheme(options.theme),
    });

    function publishViewport(next: BoardViewport): void {
        setViewport(next);
        interaction.viewportChanged?.();
        events.emit('viewportChange', viewport);
    }

    const observer = new ResizeObserver(() => {
        if (!destroyed) {
            renderer.resize(container.clientWidth, container.clientHeight);
            interaction.viewportChanged?.();
        }
    });
    observer.observe(container);

    return {
        ready: renderer.ready,
        setModel(next): void {
            if (destroyed) {
                return;
            }

            sourceModel = next;
            const ids = new Set(next.cards.map(card => card.blockId));

            for (const id of arrangedPositions.keys()) {
                if (!ids.has(id)) {
                    arrangedPositions.delete(id);
                }
            }

            model = arrangedPositions.size
                ? {
                      ...next,
                      cards: next.cards.map(card =>
                          arrangedPositions.has(card.blockId) && !card.pinned
                              ? {
                                    ...card,
                                    position: arrangedPositions.get(card.blockId)!,
                                }
                              : card
                      ),
                  }
                : next;
            renderer.setModel(model);
            interaction.modelChanged?.();
        },
        on: events.on,
        viewport: {
            get: () => viewport,
            set: publishViewport,
            fitAll(padding): void {
                publishViewport(
                    fitBounds(
                        renderer.getGeometry().bounds,
                        container.clientWidth,
                        container.clientHeight,
                        padding
                    )
                );
            },
            zoomTo(zoomOrBlockId, anchor): void {
                if (typeof zoomOrBlockId === 'string') {
                    const exists = renderer
                        .getGeometry()
                        .cards.some(card => card.blockId === zoomOrBlockId);

                    if (exists) {
                        setViewport({ ...viewport, zoom: 1 });
                        const card = renderer
                            .getGeometry()
                            .cards.find(card => card.blockId === zoomOrBlockId)!;
                        publishViewport(
                            fitBounds(
                                card.bounds,
                                container.clientWidth,
                                container.clientHeight,
                                64
                            )
                        );
                    }

                    return;
                }

                publishViewport(
                    zoomAt(
                        viewport,
                        zoomOrBlockId,
                        anchor ?? {
                            x: container.clientWidth / 2,
                            y: container.clientHeight / 2,
                        }
                    )
                );
            },
        },
        arrange(): void {
            if (destroyed) {
                return;
            }

            model = {
                ...sourceModel,
                version: sourceModel.version + 1,
                cards: sourceModel.cards.map(card =>
                    card.pinned ? card : { ...card, position: undefined }
                ),
            };
            renderer.setModel(model);
            const pinned = new Set(
                sourceModel.cards.filter(card => card.pinned).map(card => card.blockId)
            );

            for (const card of renderer.getGeometry().cards) {
                if (!pinned.has(card.blockId)) {
                    arrangedPositions.set(card.blockId, {
                        x: card.bounds.x,
                        y: card.bounds.y,
                    });
                }
            }

            interaction.modelChanged?.();
        },
        getGeometry: () => renderer.getGeometry(),
        getStats: () => renderer.getStats(),
        destroy(): void {
            if (destroyed) {
                return;
            }

            destroyed = true;
            observer.disconnect();
            interaction.destroy();
            events.clear();
            renderer.destroy();
            model = {
                version: 0,
                cards: [],
                connections: [],
                selection: null,
                state: 'empty',
            };
            sourceModel = model;
            arrangedPositions.clear();
        },
    };
}
