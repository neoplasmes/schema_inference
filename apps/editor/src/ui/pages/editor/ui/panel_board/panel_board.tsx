import { useEffect } from 'react';
import type { PlaygroundScene } from '../../../../../../playground';
import { useSchemaBoard } from '../../model/schema_board';
import type { PanelDiagnostic } from '../../model/diagnostics';
import styles from './panel_board.module.css';

export function PanelBoard({
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
    }, [
        canvas.ready,
        canvas.board,
        panel,
        report,
    ]);

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
