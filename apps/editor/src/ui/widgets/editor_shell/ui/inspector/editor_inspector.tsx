import type { EditorShellProps } from '../../model';
import { inspectSelection } from '../../lib/selection';
import styles from '../EditorShell.module.css';

type InspectorProps = Pick<
    EditorShellProps,
    'model' | 'demo' | 'onVariant' | 'message'
> & {
    mode: EditorShellProps['mode'];
    notice: string | null;
    setNotice(message: string): void;
};

export function EditorInspector(props: InspectorProps): React.JSX.Element {
    const { mode, notice, setNotice } = props;
    const { selectedRow, inspected, variants, activeVariant, currentName, path } =
        inspectSelection(props.model);

    return (
        <aside
            className={`${styles.panel} ${styles.inspector}`}
            aria-label="Selection inspector"
        >
            {inspected ? (
                <>
                    <div className={styles.inspectorTitle}>
                        <div>
                            <strong>{currentName}</strong>
                            <span>element</span>
                        </div>
                        <span className={styles.path}>{path}</span>
                    </div>
                    <div className={styles.separator} />
                    <div className={styles.propertyGrid}>
                        <label className={styles.fullProperty}>
                            Namespace
                            <input
                                readOnly
                                value={
                                    inspected.namespace ??
                                    (props.demo && variants ? 'urn:shop:orders' : '')
                                }
                            />
                        </label>
                        <label>
                            minOccurs
                            <input
                                readOnly
                                value={
                                    selectedRow?.occurrenceLabel?.split('..')[0] ?? '1'
                                }
                            />
                        </label>
                        <label>
                            maxOccurs
                            <input
                                readOnly
                                value={
                                    selectedRow?.occurrenceLabel?.split('..')[1] ?? '1'
                                }
                            />
                        </label>
                    </div>
                    <div className={styles.separator} />
                    {mode === 'evidence' && variants && activeVariant ? (
                        <>
                            <section className={styles.section}>
                                <h2>Variants in {activeVariant.total} orders</h2>
                                {variants.map(variant => (
                                    <button
                                        key={variant.variantId}
                                        className={styles.variantMetric}
                                        aria-pressed={
                                            variant.variantId === activeVariant.variantId
                                        }
                                        onClick={() =>
                                            props.onVariant?.(
                                                inspected.blockId,
                                                variant.variantId,
                                                variant.scopeId
                                            )
                                        }
                                    >
                                        <span>{variant.title}</span>
                                        <span className={styles.metricTrack}>
                                            <span
                                                style={{
                                                    width: `${(variant.count / Math.max(1, variant.total)) * 100}%`,
                                                }}
                                            />
                                        </span>
                                        <span>
                                            {variant.count}
                                            <span className={styles.secondary}>
                                                /{variant.total}
                                            </span>
                                        </span>
                                    </button>
                                ))}
                                <p>Share of order occurrences, not of documents.</p>
                                <button
                                    className={styles.primary}
                                    onClick={() =>
                                        props.onVariant?.(
                                            inspected.blockId,
                                            activeVariant.variantId,
                                            activeVariant.scopeId
                                        )
                                    }
                                >
                                    View {activeVariant.title}
                                </button>
                                <div className={styles.evidenceActions}>
                                    {[
                                        ['Allow both', 'xs:choice'],
                                        ['Merge fields', 'looser schema'],
                                        ['Build custom', 'keeps origin'],
                                    ].map(([label, hint]) => (
                                        <button
                                            key={label}
                                            aria-disabled="true"
                                            onClick={() =>
                                                setNotice(
                                                    'Applying evidence requires a semantic preview and confirmation. This demo supports observing variants only.'
                                                )
                                            }
                                        >
                                            <span>{label}</span>
                                            <span>{hint}</span>
                                        </button>
                                    ))}
                                </div>
                            </section>
                            <div className={styles.separator} />
                            <section className={styles.section}>
                                <h2>Names</h2>
                                <div className={styles.nameMetric}>
                                    <span>{currentName}</span>
                                    <span>{props.demo ? 14 : activeVariant.total}</span>
                                </div>
                                {props.demo && (
                                    <div className={styles.nameMetric}>
                                        <span>paymnet</span>
                                        <i>likely a typo</i>
                                        <span>1</span>
                                    </div>
                                )}
                                <button
                                    className={styles.textButton}
                                    onClick={() =>
                                        setNotice(
                                            'Observed spelling variants remain separate in this demo.'
                                        )
                                    }
                                >
                                    Keep separate
                                </button>
                            </section>
                            <div className={styles.separator} />
                            {props.demo && (
                                <section className={styles.section}>
                                    <h2>Sources · 3 of 10</h2>
                                    <div className={styles.sources}>
                                        {[
                                            'orders_0412.xml',
                                            'orders_0413.xml',
                                            'batch_07.xml',
                                        ].map((file, index) => (
                                            <span key={file}>
                                                {file}{' '}
                                                <span>
                                                    /order[{index === 2 ? 3 : 1}
                                                    ]/payment
                                                </span>
                                            </span>
                                        ))}
                                    </div>
                                    <button
                                        className={styles.textButton}
                                        onClick={() =>
                                            setNotice(
                                                'These are the three source examples available in this demo fixture.'
                                            )
                                        }
                                    >
                                        Next page
                                    </button>
                                </section>
                            )}
                        </>
                    ) : (
                        <section className={styles.section}>
                            <h2>Loaded structure</h2>
                            <p>
                                {inspected.rows.length} of{' '}
                                {inspected.rowWindow.totalItems} fields loaded.
                            </p>
                            <p>
                                Press F2 on the board to rename a loaded field. Drag its
                                handle to move it.
                            </p>
                        </section>
                    )}
                </>
            ) : (
                <p className={styles.description}>
                    Select a block or field on the board or in the navigator.
                </p>
            )}
            {(props.message || notice) && (
                <p role="status" className={styles.message}>
                    {props.message ?? notice}
                </p>
            )}
        </aside>
    );
}
