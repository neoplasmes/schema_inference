import styles from '../editorShell.module.css';

export function NodeIcon({
    attribute = false,
}: {
    attribute?: boolean;
}): React.JSX.Element {
    return attribute ? (
        <span className={styles.icon}>@</span>
    ) : (
        <svg
            className={styles.icon}
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="m5.5 4-3 3 3 3m3-6 3 3-3 3" />
        </svg>
    );
}
