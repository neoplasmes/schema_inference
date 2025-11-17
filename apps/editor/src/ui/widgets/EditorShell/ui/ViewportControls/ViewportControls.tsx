import type { EditorShellProps } from '../../model';
import styles from '../editorShell.module.css';

type ViewportControlsProps = Pick<
    EditorShellProps,
    'onZoom' | 'zoom' | 'onFit' | 'onArrange'
>;

export function ViewportControls(props: ViewportControlsProps): React.JSX.Element {
    return (
        <div
            className={`${styles.panel} ${styles.viewportControls}`}
            aria-label="Board viewport controls"
        >
            <button
                className={styles.iconButton}
                aria-label="Zoom out"
                onClick={() => props.onZoom(props.zoom / 1.2)}
            >
                −
            </button>
            <span className={styles.zoom}>{Math.round(props.zoom * 100)}%</span>
            <button
                className={styles.iconButton}
                aria-label="Zoom in"
                onClick={() => props.onZoom(props.zoom * 1.2)}
            >
                +
            </button>
            <button
                className={styles.detailButton}
                onClick={props.onFit}
                title="Fit the loaded structure"
            >
                {props.zoom < 0.35
                    ? 'Overview'
                    : props.zoom > 0.75
                      ? 'Working detail'
                      : 'Working detail'}
            </button>
            <button className={styles.arrange} onClick={props.onArrange ?? props.onFit}>
                Arrange
            </button>
        </div>
    );
}
