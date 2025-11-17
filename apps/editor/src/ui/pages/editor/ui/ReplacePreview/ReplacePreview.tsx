import { useState, type KeyboardEvent } from 'react';
import styles from './replacePreview.module.css';

const changes = [
    [
        '+',
        'order/payment/inn',
        'string · 1',
    ],
    [
        '+',
        'order/payment/bank',
        'complex · 9 nested',
    ],
    [
        '+',
        'order/payment/bank/name',
        'string · 1',
    ],
    [
        '+',
        'order/payment/bank/account',
        'string · 1',
    ],
    [
        '+',
        'order/payment/bic',
        'string · 0..1',
    ],
    [
        '−',
        'order/payment/number',
        'Card field',
    ],
    [
        '−',
        'order/payment/holder',
        'Card field',
    ],
    [
        '~',
        'origin of payment',
        'suggested Card → observed Invoice',
    ],
] as const;

export default function ReplacePreview({
    onClose,
}: {
    onClose(): void;
}): React.JSX.Element {
    const [notice, setNotice] = useState<string | null>(null);

    function keyboard(event: KeyboardEvent<HTMLDivElement>): void {
        if (event.key === 'Escape') {
            onClose();
        }

        if (event.key === 'Tab') {
            const controls = [
                ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                    'button:not(:disabled)'
                ),
            ];
            const index = controls.indexOf(document.activeElement as HTMLButtonElement);
            const next = event.shiftKey
                ? (index - 1 + controls.length) % controls.length
                : (index + 1) % controls.length;
            event.preventDefault();
            controls[next]?.focus();
        }
    }

    return (
        <div className={styles.scrim}>
            <div
                className={styles.dialog}
                role="dialog"
                aria-modal="true"
                aria-labelledby="replace-preview-title"
                onKeyDown={keyboard}
            >
                <div className={styles.heading}>
                    <div>
                        <h1 id="replace-preview-title">Replace payment with Invoice</h1>
                        <span>Demo evidence preview · editable draft unchanged</span>
                    </div>
                    <button autoFocus aria-label="Close preview" onClick={onClose}>
                        ×
                    </button>
                </div>
                <div className={styles.metrics}>
                    {[
                        [
                            '12',
                            'nodes added',
                        ],
                        [
                            '2',
                            'nodes removed',
                        ],
                        [
                            '2',
                            'example edits affected',
                        ],
                        [
                            '0',
                            'broken references',
                        ],
                    ].map(([count, label]) => (
                        <div key={label}>
                            <strong>{count}</strong>
                            <span>{label}</span>
                        </div>
                    ))}
                </div>
                <section className={styles.manual}>
                    <h2>Example edits that leave with Card</h2>
                    <div>
                        <span>payment/holder · minOccurs 1 → 0</span>
                        <span>Demo example</span>
                        <button
                            onClick={() =>
                                setNotice(
                                    'The holder field belongs to the Card structure and is absent from Invoice.'
                                )
                            }
                        >
                            Show
                        </button>
                    </div>
                    <div>
                        <span>payment/number · renamed from card_number</span>
                        <span>Demo example</span>
                        <button
                            onClick={() =>
                                setNotice(
                                    'The number field belongs to the Card structure and is absent from Invoice.'
                                )
                            }
                        >
                            Show
                        </button>
                    </div>
                </section>
                <section className={styles.diff}>
                    <div className={styles.diffHeading}>
                        <h2>Changes</h2>
                        <span>
                            <b>8</b> of 15
                        </span>
                    </div>
                    <div className={styles.rows}>
                        {changes.map(([change, path, detail]) => (
                            <div
                                key={path}
                                className={change === '−' ? styles.removed : ''}
                            >
                                <span className={change === '+' ? styles.added : ''}>
                                    {change}
                                </span>
                                <span>{path}</span>
                                <span>{detail}</span>
                            </div>
                        ))}
                    </div>
                    <button
                        className={styles.textButton}
                        onClick={() =>
                            setNotice(
                                'Only this page of illustrative differences is included in the demo fixture.'
                            )
                        }
                    >
                        Next page · 7 more
                    </button>
                </section>
                <p className={styles.description} role="status">
                    {notice ??
                        'This illustrative preview does not apply a replacement. Applying evidence requires the schema preview API and one semantic history operation.'}
                </p>
                <footer>
                    <button
                        onClick={() =>
                            setNotice(
                                'Building a custom schema from evidence is unavailable in this demo.'
                            )
                        }
                    >
                        Build custom instead
                    </button>
                    <button onClick={onClose}>Cancel</button>
                    <button className={styles.primary} disabled>
                        Replacement unavailable
                    </button>
                </footer>
            </div>
        </div>
    );
}
