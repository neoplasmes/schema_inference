import { useMemo, useState } from 'react';
import { getScene } from '../../../../../../playground';
import type { BoardModel, BoardViewport } from '../../../../../board';
import type { EditorProps } from '../../model/resource';
import { EditorShell } from '../../../../widgets/EditorShell';
import { ReplacePreview } from '../ReplacePreview';
import { useEditorController } from '../../model/controller';
import { projectSession } from '../../model/session';
import { useSchemaBoard } from '../../model/schemaBoard';
import { usePlaygroundDiagnostics } from '../../model/diagnostics';
import { PanelBoard } from '../PanelBoard';
import styles from './editorApplication.module.css';
import '../../../../../shared/ui/theme';

const backgroundModel: BoardModel = {
    version: 0,
    state: 'ready',
    selection: null,
    cards: [],
    connections: [],
};

export default function EditorApplication(props: EditorProps): React.JSX.Element {
    const scene = useMemo(
        () => getScene(new URLSearchParams(window.location.search).get('scene')),
        []
    );
    const controller = useEditorController(props, scene);
    const { session, version, error, demo } = controller.projection;
    const model = useMemo(
        () =>
            projectSession({
                session,
                version,
                error,
                demo,
            }),
        [
            session,
            version,
            error,
            demo,
        ]
    );
    const [zoom, setZoom] = useState(scene.camera.zoom);
    const [previewOpen, setPreviewOpen] = useState(scene.id === 'replace-preview');
    const hasPanels = controller.demo && !!scene.panels;
    const handlers = {
        ...controller.handlers,
        viewportChange: (viewport: BoardViewport) => setZoom(viewport.zoom),
    };
    const canvas = useSchemaBoard(
        hasPanels ? backgroundModel : model,
        scene.camera,
        hasPanels ? {} : handlers,
        `${controller.resourceKey}/${scene.id}`
    );
    const { reportPanel } = usePlaygroundDiagnostics(
        scene,
        controller,
        model,
        canvas,
        hasPanels
    );
    const showShell = !controller.demo || scene.shell !== 'none';

    return (
        <div className={`schema-editor ${styles.root}`}>
            <div
                className={styles.board}
                ref={canvas.container}
                style={
                    hasPanels
                        ? {
                              pointerEvents: 'none',
                          }
                        : undefined
                }
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
                    model={model}
                    title={controller.title}
                    profile={controller.session?.document.manifest.profile}
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
