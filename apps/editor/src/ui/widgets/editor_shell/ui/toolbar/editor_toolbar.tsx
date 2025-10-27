import type { EditorShellProps } from '../../model';
import styles from '../EditorShell.module.css';

type ToolbarProps = Pick<
    EditorShellProps,
    | 'title'
    | 'profile'
    | 'onExit'
    | 'canUndo'
    | 'canRedo'
    | 'onUndo'
    | 'onRedo'
    | 'demo'
    | 'busy'
    | 'saveBlocked'
    | 'pendingChanges'
    | 'onSave'
> & {
    mode: EditorShellProps['mode'];
    setMode(mode: EditorShellProps['mode']): void;
    search: string;
    setSearch(search: string): void;
    setNotice(message: string): void;
};

export function EditorToolbar(props: ToolbarProps): React.JSX.Element {
    const { mode, setMode, search, setSearch, setNotice } = props;

    return (
        <header className={`${styles.panel} ${styles.toolbar}`}>
            <div className={styles.projectTitle}>
                {props.onExit && (
                    <button
                        className={styles.button}
                        onClick={props.onExit}
                        aria-label="Exit editor"
                    >
                        ‹
                    </button>
                )}
                <strong>{props.title}</strong>
                <span className={styles.secondary}>{props.profile?.syntax === 'xml' ? 'XSD 1.0' : props.profile ? 'JSON Schema 2020-12' : 'Loading schema…'}</span>
            </div>
            <div className={styles.segment} role="group" aria-label="Editor mode">
                <button
                    aria-pressed={mode === 'builder'}
                    onClick={() => setMode('builder')}
                >
                    Builder
                </button>
                <button
                    aria-pressed={mode === 'evidence'}
                    onClick={() => setMode('evidence')}
                >
                    Evidence
                </button>
            </div>
            <label className={styles.search}>
                <svg
                    width="14"
                    height="14"
                    viewBox="0 0 14 14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    aria-hidden="true"
                >
                    <circle cx="6" cy="6" r="4.5" />
                    <path d="m9.5 9.5 3.5 3.5" />
                </svg>
                <input
                    aria-label="Search loaded schema"
                    placeholder="Search the loaded schema"
                    value={search}
                    onChange={event => setSearch(event.target.value)}
                />
            </label>
            <div className={styles.toolbarActions}>
                <button
                    className={styles.iconButton}
                    aria-label="Undo"
                    disabled={!props.canUndo}
                    onClick={props.onUndo}
                >
                    ↶
                </button>
                <button
                    className={styles.iconButton}
                    aria-label="Redo"
                    disabled={!props.canRedo}
                    onClick={props.onRedo}
                >
                    ↷
                </button>
                <button
                    className={styles.saveStatus}
                    aria-label={props.demo ? 'Save in demo' : 'Save schema'}
                    disabled={
                        props.busy || props.saveBlocked || props.pendingChanges === 0
                    }
                    onClick={props.onSave}
                >
                    {props.busy
                        ? 'Saving...'
                        : props.pendingChanges
                          ? `Save ${props.pendingChanges} changes`
                          : props.demo
                            ? 'Demo · saved locally'
                            : 'No local changes'}
                </button>
                <button
                    className={styles.primary}
                    onClick={() =>
                        setNotice(
                            'Schema export is not available yet. This editor has not exported a file.'
                        )
                    }
                    title="Schema export is unavailable"
                >
                    Export
                </button>
            </div>
        </header>
    );
}
