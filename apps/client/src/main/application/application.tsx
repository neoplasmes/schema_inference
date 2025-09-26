import { createRoot } from 'react-dom/client';
import { CacheProvider, createCacheRuntime } from '../../env/cache';
import { Application } from '../../ui/application';
import { DependenciesContext } from '../../ui/di';
import { createDependencies } from '../dependencies';
import '../main.css';

function browserStorage(): Storage | undefined {
    try {
        return window.localStorage;
    } catch {
        return undefined;
    }
}

export function renderApplication(element: HTMLElement): void {
    const runtime = createCacheRuntime();
    const dependencies = createDependencies(browserStorage());

    createRoot(element).render(
        <CacheProvider runtime={runtime}>
            <DependenciesContext.Provider value={dependencies}>
                <Application />
            </DependenciesContext.Provider>
        </CacheProvider>
    );
}
