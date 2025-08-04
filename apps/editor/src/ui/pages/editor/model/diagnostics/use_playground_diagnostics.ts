import { useEffect, useRef } from 'react';
import type { PlaygroundScene } from '../../../../../../playground';
import type {
    BoardGeometry,
    BoardModel,
    BoardRenderStats,
    BoardViewport,
    SchemaBoard,
} from '../../../../../board';
import type { EditorController } from '../controller';
import type { useSchemaBoard } from '../schema_board';

export type PanelDiagnostic = {
    ready: boolean;
    board: SchemaBoard | null;
    model: BoardModel;
    containerRect: NonNullable<PlaygroundScene['panels']>[number]['containerRect'];
};
type PlaygroundDiagnostic = {
    ready: boolean;
    scene: string;
    model: BoardModel;
    viewport: BoardViewport;
    geometry: BoardGeometry | null;
    stats: BoardRenderStats;
    document: {
        operations: unknown;
        revision: string | null;
        canUndo: boolean;
        canRedo: boolean;
    };
    panels?: readonly unknown[];
};

declare global {
    interface Window {
        __editorPlayground?: { read(): PlaygroundDiagnostic };
    }
}

const emptyStats: BoardRenderStats = {
    renderedFrames: 0,
    visibleCards: 0,
    visibleConnections: 0,
    textObjects: 0,
    lod: 'working',
};

export function usePlaygroundDiagnostics(
    scene: PlaygroundScene,
    controller: EditorController,
    model: BoardModel,
    canvas: ReturnType<typeof useSchemaBoard>,
    hasPanels: boolean
) {
    const panels = useRef(new Map<string, PanelDiagnostic>());
    const reportPanel = useRef((id: string, diagnostic: PanelDiagnostic | null) => {
        if (diagnostic) {
            panels.current.set(id, diagnostic);
        } else {
            panels.current.delete(id);
        }
    }).current;
    const diagnostic = useRef<() => PlaygroundDiagnostic>(() => ({
        ready: false,
        scene: scene.id,
        model,
        viewport: scene.camera,
        geometry: null,
        stats: emptyStats,
        document: { operations: [], revision: null, canUndo: false, canRedo: false },
    }));
    diagnostic.current = () => {
        const panelResults = [...panels.current.entries()].map(([id, panel]) => ({
            id,
            ready: panel.ready,
            model: panel.model,
            containerRect: panel.containerRect,
            viewport: panel.board?.viewport.get(),
            geometry: panel.board?.getGeometry(),
            stats: panel.board?.getStats() ?? emptyStats,
        }));
        const stats = hasPanels
            ? panelResults.reduce(
                  (total, panel) => ({
                      ...total,
                      renderedFrames: total.renderedFrames + panel.stats.renderedFrames,
                      visibleCards: total.visibleCards + panel.stats.visibleCards,
                      visibleConnections:
                          total.visibleConnections + panel.stats.visibleConnections,
                      textObjects: total.textObjects + panel.stats.textObjects,
                  }),
                  emptyStats
              )
            : (canvas.board.current?.getStats() ?? emptyStats);
        const ready = hasPanels
            ? canvas.ready &&
              panelResults.length === scene.panels?.length &&
              panelResults.every(panel => panel.ready)
            : canvas.ready && !!controller.session;

        return structuredClone({
            ready,
            scene: scene.id,
            model,
            viewport: canvas.board.current?.viewport.get() ?? scene.camera,
            geometry: canvas.board.current?.getGeometry() ?? null,
            stats,
            document: {
                operations: controller.session?.document.operations ?? [],
                revision: controller.session?.document.manifest.snapshot.revision ?? null,
                canUndo: controller.canUndo,
                canRedo: controller.canRedo,
            },
            ...(hasPanels ? { panels: panelResults } : {}),
        });
    };

    useEffect(() => {
        const handle = { read: () => diagnostic.current() };
        window.__editorPlayground = handle;

        return () => {
            if (window.__editorPlayground === handle) {
                delete window.__editorPlayground;
            }
        };
    }, []);

    return { reportPanel };
}
