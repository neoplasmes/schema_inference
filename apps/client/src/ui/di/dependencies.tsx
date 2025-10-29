import { createContext, useContext } from 'react';
import type { ComponentType } from 'react';
import type { EditorProps } from 'schema_editor/Editor';
import type { Command } from '../../app/commands';
import type { Query } from '../../app/queries';
import type { CreateAnalysisInput, RecordSchemaSavedInput } from '../../app/ports/repos';
import type { Analysis, SchemaSummary } from '../../core/entities';

export interface Dependencies {
    mode: 'mock' | 'api';
    listSchemas: Query<Record<string, never>, SchemaSummary[]>;
    getSchema: Query<
        {
            id: string;
        },
        SchemaSummary
    >;
    getAnalysis: Query<
        {
            id: string;
        },
        Analysis
    >;
    createAnalysis: Command<CreateAnalysisInput, Analysis>;
    recordSchemaSaved: Command<RecordSchemaSavedInput, SchemaSummary>;
    loadEditor(): Promise<{
        default: ComponentType<EditorProps>;
    }>;
    editorRequest?: EditorProps['request'];
    apiBaseUrl: string;
    createId(): string;
}

export const DependenciesContext = createContext<Dependencies | null>(null);

export function useDependencies(): Dependencies {
    const dependencies = useContext(DependenciesContext);

    if (!dependencies) {
        throw new Error('Application dependencies are unavailable.');
    }

    return dependencies;
}
