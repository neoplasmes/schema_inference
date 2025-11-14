import type { EditorShellProps } from '../../model';
import { inspectSelection } from '../../lib/selection';
import styles from '../EditorShell.module.css';

type ComparisonProps = Pick<EditorShellProps, 'model' | 'onPreview' | 'message'> & {
    notice: string | null;
    setNotice(message: string): void;
};

export function VariantComparison(props: ComparisonProps): React.JSX.Element {
    const { notice, setNotice } = props;
    const { inspected, variants, activeVariant } = inspectSelection(props.model);
    const fields = inspected?.rows ?? [];

    return (
        <div className={styles.shell}>
            <aside
                className={`${styles.panel} ${styles.comparison}`}
                aria-label="Variant comparison"
            >
                <div className={styles.comparisonHeading}>
                    <h1>Variants of {inspected?.title ?? 'payment'}</h1>
                    <span>
                        {variants?.length ?? 0} structures across{' '}
                        {activeVariant?.total ?? 0} orders
                    </span>
                </div>
                <div className={styles.comparisonMetrics}>
                    {[
                        [
                            fields.filter(row => row.change === 'unchanged').length,
                            'shared',
                        ],
                        [
                            fields.filter(row => row.change === 'removed').length,
                            'only in Card',
                        ],
                        [
                            fields.filter(row => row.change === 'added').length,
                            'only in Invoice',
                        ],
                    ].map(([count, label]) => (
                        <div key={label}>
                            <strong>{count}</strong>
                            <span>{label}</span>
                        </div>
                    ))}
                </div>
                <div className={styles.comparisonWarning}>
                    <strong>Card fields leave with Card</strong>
                    <span>number and holder are absent from Invoice.</span>
                    <span>
                        Viewing this structure preserves the draft and its manual edits.
                    </span>
                </div>
                <section className={`${styles.section} ${styles.comparisonChoices}`}>
                    <h2>What to do with the draft</h2>
                    <button className={styles.primary} onClick={props.onPreview}>
                        Preview {activeVariant?.title ?? 'Invoice'}
                    </button>
                    {[
                        [
                            'Allow both',
                            'Adds an xs:choice with two branches',
                        ],
                        [
                            'Merge and relax',
                            'All fields, the differing ones optional. Allows combinations never observed.',
                        ],
                        [
                            'Build custom',
                            'A manual copy that remembers its origin',
                        ],
                    ].map(([label, description]) => (
                        <button
                            key={label}
                            className={styles.comparisonChoice}
                            aria-disabled="true"
                            onClick={() =>
                                setNotice(
                                    'Applying or merging evidence is unavailable. The observed variant is a read-only preview.'
                                )
                            }
                        >
                            <strong>{label}</strong>
                            <span>{description}</span>
                        </button>
                    ))}
                </section>
                {(props.message || notice) && (
                    <p role="status" className={styles.message}>
                        {props.message ?? notice}
                    </p>
                )}
                <div className={styles.comparisonFooter}>
                    <span>Demo preview · draft unchanged</span>
                    <span>Ctrl Z</span>
                </div>
            </aside>
        </div>
    );
}
