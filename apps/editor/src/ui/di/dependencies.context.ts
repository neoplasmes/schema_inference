import { createContext, useContext } from 'react';
import type { EditorDependenciesFactory } from './dependencies';

export const EditorDependenciesContext = createContext<EditorDependenciesFactory | null>(
    null
);
export const EditorDependenciesProvider = EditorDependenciesContext.Provider;

export function useDependencies(): EditorDependenciesFactory {
    const dependencies = useContext(EditorDependenciesContext);

    if (!dependencies) {
        throw new Error('The editor dependencies provider is missing.');
    }

    return dependencies;
}
