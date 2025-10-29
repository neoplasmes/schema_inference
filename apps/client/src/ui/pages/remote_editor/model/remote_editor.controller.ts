import { useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import type { EditorProps } from 'schema_editor/Editor';
import { useCommand, useRead } from '../../../../env/cache';
import { useDependencies } from '../../../di';
import type { RecordSchemaSavedInput } from '../../../../app/ports/repos';

export function useRemoteEditorController() {
    const dependencies = useDependencies();
    const navigate = useNavigate();
    const [parameters] = useSearchParams();
    const demo = dependencies.mode === 'mock' && parameters.get('demo') === '1';
    const schemaId = parameters.get('schemaId') ?? (demo ? 'catalog' : '');
    const analysisId = parameters.get('analysisId') ?? '';
    const revision = parameters.get('revision') ?? undefined;
    const schema = useRead(
        dependencies.getSchema,
        {
            id: schemaId,
        },
        {
            enabled: Boolean(schemaId),
        }
    );
    const analysis = useRead(
        dependencies.getAnalysis,
        {
            id: analysisId,
        },
        {
            enabled: !schemaId && Boolean(analysisId && revision),
        }
    );
    const recordSaved = useCommand(dependencies.recordSchemaSaved);
    const lastSave = useRef<RecordSchemaSavedInput | null>(null);
    const resource: EditorProps['resource'] | null = schemaId
        ? {
              kind: 'schema',
              schemaId,
              revision,
          }
        : analysisId && revision
          ? {
                kind: 'analysis',
                analysisId,
                revision,
            }
          : null;

    const onSaved = useCallback(
        (result: { schemaId: string; revision: string }) => {
            lastSave.current = result;
            void recordSaved.execute(result).catch(() => undefined);
        },
        [
            recordSaved.execute,
        ]
    );

    const onCreated = useCallback(
        (result: { schemaId: string; revision: string }) => {
            const search = new URLSearchParams({
                schemaId: result.schemaId,
            });
            navigate(`/edit?${search}`, {
                replace: true,
            });
            onSaved(result);
        },
        [
            navigate,
            onSaved,
        ]
    );

    const retrySaved = useCallback(() => {
        if (lastSave.current) {
            void recordSaved.execute(lastSave.current).catch(() => undefined);
        }
    }, [
        recordSaved.execute,
    ]);

    const onExit = useCallback(
        () => navigate('/'),
        [
            navigate,
        ]
    );
    const retryResource = useCallback(() => {
        void (schemaId ? schema.refetch() : analysis.refetch());
    }, [
        schemaId,
        schema.refetch,
        analysis.refetch,
    ]);

    return {
        resource,
        mode: dependencies.mode,
        loadEditor: dependencies.loadEditor,
        editorRequest: dependencies.editorRequest,
        apiBaseUrl: dependencies.apiBaseUrl,
        isLoadingResource:
            Boolean(resource) && (schemaId ? schema.isPending : analysis.isPending),
        resourceError: schemaId ? schema.error : analysis.error,
        saveError: recordSaved.error,
        onExit,
        onCreated,
        onSaved,
        retrySaved,
        retryResource,
    };
}
