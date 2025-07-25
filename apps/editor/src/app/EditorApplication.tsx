import { useEffect, useMemo, useRef, useState } from 'react';
import { getScene, type PlaygroundScene } from '../../playground/scenes';
import type {
    BoardGeometry,
    BoardModel,
    BoardRenderStats,
    BoardViewport,
    SchemaBoard,
} from '../board';
import type { EditorProps } from '../expose/Editor';
import EditorShell from '../shell/EditorShell';
import ReplacePreview from './ReplacePreview';
import { useEditorController } from './useEditorController';
import { createEditorDependencies } from '../main/dependencies';
import type { EditorDependenciesFactory } from './dependencies';
import { useSchemaBoard } from './useSchemaBoard';
import styles from './EditorApplication.module.css';
import '../theme/tokens.css';

type PanelDiagnostic = {
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

const backgroundModel: BoardModel = {
    version: 0,
    state: 'ready',
    selection: null,
    cards: [],
    connections: [],
};

const emptyStats: BoardRenderStats = {
    renderedFrames: 0,
    visibleCards: 0,
    visibleConnections: 0,
    textObjects: 0,
    lod: 'working',
};

function PanelBoard({
    panel,
    identity,
    report,
}: {
    panel: NonNullable<PlaygroundScene['panels']>[number];
    identity: string;
    report(id: string, diagnostic: PanelDiagnostic | null): void;
}): React.JSX.Element {
    const canvas = useSchemaBoard(panel.board, panel.camera, {}, identity, false);

    useEffect(() => {
        report(panel.id, {
            ready: canvas.ready,
            board: canvas.board.current,
            model: panel.board,
            containerRect: panel.containerRect,
        });

        return () => report(panel.id, null);
    }, [canvas.ready, canvas.board, panel, report]);

    return (
        <div
            ref={canvas.container}
            className={styles.panelBoard}
            style={{
                left: panel.containerRect.x,
                top: panel.containerRect.y,
                width: panel.containerRect.width,
                height: panel.containerRect.height,
            }}
        />
    );
}

export default function EditorApplication(props: EditorProps): React.JSX.Element {
    const scene = useMemo(
        () => getScene(new URLSearchParams(window.location.search).get('scene')),
        []
    );
    const dependencies = useMemo<EditorDependenciesFactory>(
        () => fixture => createEditorDependencies(props.apiBaseUrl, fixture),
        [props.apiBaseUrl]
    );
    const controller = useEditorController(props, scene, dependencies);
    const [zoom, setZoom] = useState(scene.camera.zoom);
    const [previewOpen, setPreviewOpen] = useState(scene.id === 'replace-preview');
    const hasPanels = controller.demo && !!scene.panels;
    const handlers = {
        ...controller.handlers,
        viewportChange: (viewport: BoardViewport) => setZoom(viewport.zoom),
    };
    const canvas = useSchemaBoard(
        hasPanels ? backgroundModel : controller.model,
        scene.camera,
        hasPanels ? {} : handlers,
        `${controller.resourceKey}/${scene.id}`
    );
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
        model: controller.model,
        viewport: scene.camera,
        geometry: null,
        stats: emptyStats,
        document: { operations: [], revision: null, canUndo: false, canRedo: false },
    }));
    const showShell = !controller.demo || scene.shell !== 'none';
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
            model: controller.model,
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

    return (
        <div className={`schema-editor ${styles.root}`}>
            <div
                className={styles.board}
                ref={canvas.container}
                style={hasPanels ? { pointerEvents: 'none' } : undefined}
            />
            {hasPanels &&
                scene.panels?.map(panel => (
                    <PanelBoard
                        key={`${controller.resourceKey}/${panel.id}`}
                        panel={panel}
                        identity={`${controller.resourceKey}/${panel.id}`}
                        report={reportPanel}
                    />
                ))}
            {showShell && (
                <EditorShell
                    model={controller.model}
                    title={controller.title}
                    mode={scene.shell === 'builder' ? 'builder' : 'evidence'}
                    presentation={
                        controller.demo && scene.id === 'variants' ? 'comparison' : 'main'
                    }
                    onPreview={() => setPreviewOpen(true)}
                    demo={controller.demo}
                    busy={controller.busy}
                    saveBlocked={controller.saveBlocked}
                    canUndo={controller.canUndo}
                    canRedo={controller.canRedo}
                    pendingChanges={controller.pendingChanges}
                    zoom={zoom}
                    message={controller.message}
                    onSelect={selection => {
                        controller.select(selection);
                        canvas.board.current?.viewport.zoomTo(selection.blockId);
                    }}
                    onExpand={(blockId, memberId, expanded) => {
                        void controller.expand(blockId, memberId, expanded);
                    }}
                    onVariant={(blockId, variantId, scopeId) =>
                        controller.handlers.variantChange?.({
                            blockId,
                            variantId,
                            scopeId,
                        })
                    }
                    onFit={() => canvas.board.current?.viewport.fitAll()}
                    onArrange={() => canvas.board.current?.arrange()}
                    onZoom={next => canvas.board.current?.viewport.zoomTo(next)}
                    onUndo={controller.undo}
                    onRedo={controller.redo}
                    onSave={() => {
                        void controller.save();
                    }}
                    onExit={props.onExit}
                />
            )}
            {controller.demo && previewOpen && (
                <ReplacePreview onClose={() => setPreviewOpen(false)} />
            )}
            {(controller.error || canvas.error) && (
                <div className={styles.notification} role="alert">
                    <p>{controller.error ?? canvas.error}</p>
                    <button onClick={controller.retry}>Retry loading</button>
                </div>
            )}
        </div>
    );
}
