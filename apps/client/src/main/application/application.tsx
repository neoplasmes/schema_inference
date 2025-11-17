import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CacheProvider, createCacheRuntime } from '../../env/cache';
import { Application } from '../../ui/Application';
import { DependenciesContext, type Dependencies } from '../../ui/di';
import { loadRuntimeConfiguration } from '../runtime';
import { createDependencies } from '../dependencies';
import '../main.css';

function browserStorage(): Storage | undefined {
    try {
        return window.localStorage;
    } catch {
        return undefined;
    }
}

function ConfiguredApplication(): React.JSX.Element {
    const [dependencies, setDependencies] = useState<Dependencies | null>(null);
    const [error, setError] = useState(false);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        let active = true;
        setError(false);
        void loadRuntimeConfiguration()
            .then(configuration => {
                if (active) {
                    setDependencies(createDependencies(configuration, browserStorage()));
                }
            })
            .catch(() => {
                if (active) {
                    setError(true);
                }
            });

        return () => {
            active = false;
        };
    }, [
        attempt,
    ]);

    if (error) {
        return (
            <main role="alert">
                <h1>Workspace could not load</h1>
                <button type="button" onClick={() => setAttempt(value => value + 1)}>
                    Try again
                </button>
            </main>
        );
    }

    if (!dependencies) {
        return <main role="status">Loading workspace…</main>;
    }

    return (
        <DependenciesContext.Provider value={dependencies}>
            <Application />
        </DependenciesContext.Provider>
    );
}

export function renderApplication(element: HTMLElement): void {
    const runtime = createCacheRuntime();

    createRoot(element).render(
        <CacheProvider runtime={runtime}>
            <ConfiguredApplication />
        </CacheProvider>
    );
}
