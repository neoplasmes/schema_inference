import { Component, lazy, Suspense, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useRemoteEditorController } from '../model';
import styles from './remote_editor.module.css';

class EditorErrorBoundary extends Component<
    {
        children: ReactNode;
        onRetry(): void;
    },
    {
        failed: boolean;
    }
> {
    state = {
        failed: false,
    };

    static getDerivedStateFromError(): {
        failed: boolean;
    } {
        return {
            failed: true,
        };
    }

    render(): ReactNode {
        if (this.state.failed) {
            return (
                <div role="alert" className={styles.message}>
                    <h1>Editor could not load</h1>
                    <p>
                        The editor service may be unavailable. Your saved schemas are
                        safe.
                    </p>
                    <button type="button" onClick={this.props.onRetry}>
                        Try again
                    </button>
                    <Link to="/">Back to workspace</Link>
                </div>
            );
        }

        return this.props.children;
    }
}

export function RemoteEditorPage(): React.JSX.Element {
    const controller = useRemoteEditorController();
    const [attempt, setAttempt] = useState(0);
    const Editor = useMemo(
        () => lazy(controller.loadEditor),
        [
            controller.loadEditor,
            attempt,
        ]
    );

    if (!controller.resource) {
        return (
            <div className={styles.message}>
                <h1>Choose a schema to edit</h1>
                <p>Open a saved schema or create an analysis from the workspace.</p>
                <Link to="/">Back to workspace</Link>
                <Link to="/edit?demo=1">Open sample editor</Link>
            </div>
        );
    }

    if (controller.resourceError) {
        return (
            <div role="alert" className={styles.message}>
                <h1>This resource is unavailable</h1>
                <p>The link may refer to data from a different browser.</p>
                <button type="button" onClick={controller.retryResource}>
                    Try again
                </button>
                <Link to="/">Back to workspace</Link>
            </div>
        );
    }

    if (controller.isLoadingResource) {
        return (
            <div role="status" className={styles.message}>
                Opening your schema…
            </div>
        );
    }

    return (
        <div className={styles.editor}>
            {controller.saveError && (
                <div role="alert" className={styles.saveError}>
                    The editor saved your changes, but the workspace list could not
                    update.{' '}
                    <button type="button" onClick={controller.retrySaved}>
                        Retry list update
                    </button>
                </div>
            )}
            <EditorErrorBoundary
                key={attempt}
                onRetry={() => setAttempt(value => value + 1)}
            >
                <Suspense
                    fallback={
                        <div role="status" className={styles.message}>
                            Loading editor…
                        </div>
                    }
                >
                    <Editor
                        resource={controller.resource}
                        apiBaseUrl="mock://workspace"
                        request={controller.editorRequest}
                        onExit={controller.onExit}
                        onSaved={controller.onSaved}
                    />
                </Suspense>
            </EditorErrorBoundary>
        </div>
    );
}
