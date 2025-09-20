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
    const demo = parameters.get('demo') === '1';
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
        (result: Parameters<NonNullable<EditorProps['onSaved']>>[0]) => {
            const input = {
                ...result,
                title: schema.data?.title ?? analysis.data?.title,
                documentCount:
                    schema.data?.documentCount ?? analysis.data?.documents.length,
            };
            lastSave.current = input;
            void recordSaved.execute(input).catch(() => undefined);
        },
        [
            schema.data,
            analysis.data,
            recordSaved.execute,
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
        loadEditor: dependencies.loadEditor,
        editorRequest: dependencies.editorRequest,
        isLoadingResource:
            Boolean(resource) && (schemaId ? schema.isPending : analysis.isPending),
        resourceError: schemaId ? schema.error : analysis.error,
        saveError: recordSaved.error,
        onExit,
        onSaved,
        retrySaved,
        retryResource,
    };
}
