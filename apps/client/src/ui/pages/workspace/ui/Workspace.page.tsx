import { Link } from 'react-router';
import { useWorkspaceController } from '../model';
import styles from './workspace.page.module.css';

export function WorkspacePage(): React.JSX.Element {
    const controller = useWorkspaceController();

    return (
        <main className={styles.page}>
            <header className={styles.header}>
                <Link className={styles.brand} to="/" aria-label="Schema workspace home">
                    <span className={styles.mark}>S</span> Schema Studio
                </Link>
                <span className={styles.badge}>
                    {controller.mode === 'mock' ? 'Local demo' : 'Your workspace'}
                </span>
            </header>
            <section className={styles.introduction}>
                <p className={styles.eyebrow}>Your schema workspace</p>
                <h1>Give your documents a structure.</h1>
                <p>
                    Explore existing schemas or bring a few documents to the visual
                    editor.
                </p>
            </section>
            <div className={styles.columns}>
                <section className={styles.panel} aria-labelledby="new-analysis-heading">
                    <span className={styles.step}>01 / CREATE</span>
                    <h2 id="new-analysis-heading">Start with documents</h2>
                    <p className={styles.description}>
                        XML, YAML and JSON · up to 5 MB per file
                    </p>
                    <form
                        onSubmit={event => {
                            event.preventDefault();
                            void controller.startAnalysis();
                        }}
                    >
                        <label className={styles.field} htmlFor="analysis-title">
                            Schema title
                        </label>
                        <input
                            id="analysis-title"
                            className={styles.textInput}
                            value={controller.title}
                            onChange={event => controller.changeTitle(event.target.value)}
                            placeholder="e.g. Product catalog"
                            disabled={
                                controller.isCreating || Boolean(controller.analysisId)
                            }
                            maxLength={120}
                        />
                        <label className={styles.upload} htmlFor="source-documents">
                            <span className={styles.uploadIcon}>＋</span>
                            <strong>Choose documents</strong>
                            <span>Select one or several files from your computer</span>
                            <input
                                id="source-documents"
                                type="file"
                                multiple
                                accept=".xml,.yaml,.yml,.json"
                                onChange={event => {
                                    void controller.selectFiles(
                                        Array.from(event.target.files ?? [])
                                    );
                                }}
                                disabled={
                                    controller.isCreating ||
                                    Boolean(controller.analysisId)
                                }
                            />
                        </label>
                        {controller.isReading && (
                            <p role="status">Reading selected files…</p>
                        )}
                        {controller.documents.length > 0 && (
                            <ul className={styles.files}>
                                {controller.documents.map((document, index) => (
                                    <li key={`${document.name}-${index}`}>
                                        <span>{document.name}</span>
                                        <small>
                                            {document.format.toUpperCase()} ·{' '}
                                            {Math.max(1, Math.ceil(document.size / 1024))}{' '}
                                            KB
                                        </small>
                                    </li>
                                ))}
                            </ul>
                        )}
                        {controller.selectionError && (
                            <p role="alert" className={styles.error}>
                                {controller.selectionError}
                            </p>
                        )}
                        {controller.analysisId ? (
                            <div className={styles.progress} aria-live="polite">
                                {controller.analysis.error ? (
                                    <>
                                        <p role="alert">
                                            Analysis could not load. Try again to check
                                            its current status.
                                        </p>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                void controller.analysis.refetch();
                                            }}
                                        >
                                            Try again
                                        </button>
                                    </>
                                ) : controller.analysis.data?.status === 'failed' ? (
                                    <>
                                        <p role="alert">
                                            {controller.analysis.data.error ??
                                                'Analysis failed.'}
                                        </p>
                                        <button
                                            type="button"
                                            onClick={controller.dismissAnalysis}
                                        >
                                            Start again
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <p>
                                            Preparing schema…{' '}
                                            {controller.analysis.data?.progress ?? 0}%
                                        </p>
                                        <progress
                                            max={100}
                                            value={
                                                controller.analysis.data?.progress ?? 0
                                            }
                                        />
                                        <small>
                                            The editor opens when the analysis is ready.
                                        </small>
                                    </>
                                )}
                                <button
                                    type="button"
                                    className={styles.secondaryButton}
                                    onClick={controller.dismissAnalysis}
                                >
                                    Back to documents
                                </button>
                            </div>
                        ) : (
                            <button
                                className={styles.primaryButton}
                                type="submit"
                                disabled={!controller.canSubmit}
                            >
                                {controller.isCreating
                                    ? 'Creating analysis…'
                                    : controller.mode === 'mock'
                                      ? 'Create demo schema'
                                      : 'Create schema'}
                                <span aria-hidden="true">↗</span>
                            </button>
                        )}
                    </form>
                    {controller.mode === 'mock' && (
                        <aside className={styles.notice}>
                            <strong>This workspace uses local mock data.</strong> Files
                            stay in this browser. The analysis opens a sample model; it
                            does not infer a schema from your file contents. Saved edits
                            are kept locally.
                        </aside>
                    )}
                </section>
                <section className={styles.library} aria-labelledby="schemas-heading">
                    <div className={styles.sectionHeading}>
                        <div>
                            <span className={styles.step}>02 / EXPLORE</span>
                            <h2 id="schemas-heading">Your schemas</h2>
                        </div>
                        <button
                            type="button"
                            className={styles.refresh}
                            onClick={() => {
                                void controller.schemas.refetch();
                            }}
                        >
                            Refresh
                        </button>
                    </div>
                    {controller.schemas.isPending && (
                        <p role="status" className={styles.empty}>
                            Loading schemas…
                        </p>
                    )}
                    {controller.schemas.error && (
                        <div role="alert" className={styles.empty}>
                            <p>Schemas could not load.</p>
                            <button
                                type="button"
                                onClick={() => {
                                    void controller.schemas.refetch();
                                }}
                            >
                                Try again
                            </button>
                        </div>
                    )}
                    {controller.schemas.data?.length === 0 && (
                        <p className={styles.empty}>
                            No schemas yet. Create one from your documents.
                        </p>
                    )}
                    <div className={styles.cards}>
                        {controller.schemas.data?.map(schema => (
                            <Link
                                key={schema.id}
                                className={styles.card}
                                to={`/edit?${new URLSearchParams({
                                    schemaId: schema.id,
                                })}`}
                            >
                                <span className={styles.schemaIcon} aria-hidden="true">
                                    ⋈
                                </span>
                                <div>
                                    <h3>{schema.title}</h3>
                                    <p>
                                        {schema.documentCount} source{' '}
                                        {schema.documentCount === 1
                                            ? 'document'
                                            : 'documents'}{' '}
                                        · {schema.revision}
                                    </p>
                                    <small>
                                        Updated{' '}
                                        {new Date(schema.updatedAt).toLocaleDateString(
                                            'en-GB',
                                            {
                                                day: 'numeric',
                                                month: 'short',
                                                year: 'numeric',
                                            }
                                        )}
                                    </small>
                                </div>
                                <span className={styles.arrow} aria-hidden="true">
                                    ↗
                                </span>
                            </Link>
                        ))}
                    </div>
                    {controller.mode === 'mock' && (
                        <Link className={styles.demoLink} to="/edit?demo=1">
                            Open the sample editor <span aria-hidden="true">→</span>
                        </Link>
                    )}
                </section>
            </div>
            <footer className={styles.footer}>
                Schema Studio <span>Explore · Refine · Save</span>
            </footer>
        </main>
    );
}
