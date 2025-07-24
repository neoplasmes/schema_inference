import { Component, lazy, Suspense, useMemo, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { registerRemotes, loadRemote } from '@module-federation/enhanced/runtime';
import type { EditorProps } from 'schema_editor/Editor';
import styles from './RemoteEditorPage.module.css';

type RuntimeConfiguration = { editorManifestUrl: string; apiBaseUrl: string };

async function loadEditor(): Promise<{ default: ComponentType<EditorProps> }> {
    const response = await fetch('/editor-runtime.json', { cache: 'no-store' });

    if (!response.ok) {
        throw new Error('The editor runtime configuration is unavailable.');
    }

    const configuration = (await response.json()) as RuntimeConfiguration;

    if (!configuration.editorManifestUrl) {
        throw new Error('The editor manifest URL is missing.');
    }

    registerRemotes([{ name: 'schema_editor', entry: configuration.editorManifestUrl }], {
        force: true,
    });
    const module = await loadRemote<{ default: ComponentType<EditorProps> }>(
        'schema_editor/Editor'
    );

    if (!module) {
        throw new Error('The editor module is unavailable.');
    }

    const RemoteEditor = module.default;

    return {
        default: props => (
            <RemoteEditor
                {...props}
                apiBaseUrl={
                    props.apiBaseUrl.startsWith('fixture:')
                        ? props.apiBaseUrl
                        : configuration.apiBaseUrl
                }
            />
        ),
    };
}

class EditorErrorBoundary extends Component<
    {
        children: ReactNode;
        onRetry(): void;
    },
    { failed: boolean }
> {
    state = { failed: false };

    static getDerivedStateFromError(): { failed: boolean } {
        return { failed: true };
    }

    render(): ReactNode {
        if (this.state.failed) {
            return (
                <div role="alert" className={styles.message}>
                    <h1>Editor could not load</h1>
                    <p>Check the connection and try again.</p>
                    <button type="button" onClick={this.props.onRetry}>
                        Try again
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}

export function RemoteEditorPage(): React.JSX.Element {
    const [attempt, setAttempt] = useState(0);
    const Editor = useMemo(() => lazy(loadEditor), [attempt]);
    const parameters = new URLSearchParams(window.location.search);
    const schemaId = parameters.get('schemaId');
    const analysisId = parameters.get('analysisId');
    const revision = parameters.get('revision') ?? undefined;
    const demo = parameters.get('demo') === '1';
    const resource: EditorProps['resource'] | null = schemaId
        ? { kind: 'schema', schemaId, revision }
        : analysisId && revision
          ? { kind: 'analysis', analysisId, revision }
          : demo
            ? { kind: 'schema', schemaId: 'standalone-fixture', revision: 'fixture-1' }
            : null;

    if (!resource) {
        return (
            <div className={styles.message}>
                <h1>Choose a schema to edit</h1>
                <p>This editor requires a schema or analysis resource.</p>
                <a href="/edit?demo=1">Open fixture demo</a>
            </div>
        );
    }

    return (
        <div className={styles.editor}>
            <EditorErrorBoundary
                key={attempt}
                onRetry={() => setAttempt(value => value + 1)}
            >
                <Suspense
                    fallback={
                        <div role="status" className={styles.message}>
                            Loading editor...
                        </div>
                    }
                >
                    <Editor
                        resource={resource}
                        apiBaseUrl={demo ? 'fixture://standalone' : ''}
                        onExit={() => window.location.assign('/')}
                    />
                </Suspense>
            </EditorErrorBoundary>
        </div>
    );
}
