import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import type { DocumentInput } from '../../../../core/entities';
import { useCommand, useRead } from '../../../../env/cache';
import { useDependencies } from '../../../di';
import { readDocument } from '../lib';

function messageFor(error: unknown): string {
    return error instanceof Error
        ? error.message
        : 'The operation could not finish. Please try again.';
}

export function useWorkspaceController() {
    const dependencies = useDependencies();
    const navigate = useNavigate();
    const [parameters, setParameters] = useSearchParams();
    const analysisId = parameters.get('analysisId') ?? '';
    const schemas = useRead(dependencies.listSchemas, {});
    const analysis = useRead(
        dependencies.getAnalysis,
        {
            id: analysisId,
        },
        {
            enabled: Boolean(analysisId),
            refetchInterval: 500,
        }
    );
    const create = useCommand(dependencies.createAnalysis);
    const [title, setTitle] = useState('');
    const [documents, setDocuments] = useState<DocumentInput[]>([]);
    const [selectionError, setSelectionError] = useState<string | null>(null);
    const [isReading, setIsReading] = useState(false);
    const selectionVersion = useRef(0);
    const attemptKey = useRef<string | null>(null);

    useEffect(() => {
        if (analysis.data?.status === 'completed') {
            const search = new URLSearchParams({
                analysisId: analysis.data.id,
                revision: analysis.data.revision,
            });
            navigate(`/edit?${search}`, {
                replace: true,
            });
        }
    }, [
        analysis.data,
        navigate,
    ]);

    useEffect(
        () => () => {
            selectionVersion.current += 1;
        },
        []
    );

    const selectFiles = useCallback(async (files: File[]) => {
        const version = ++selectionVersion.current;
        attemptKey.current = null;
        setSelectionError(null);
        setIsReading(true);
        setDocuments([]);

        try {
            const selected = await Promise.all(files.map(readDocument));

            if (version === selectionVersion.current) {
                setDocuments(selected);
                setTitle(
                    current => current || selected[0]?.name.replace(/\.[^.]+$/, '') || ''
                );
            }
        } catch (error) {
            if (version === selectionVersion.current) {
                setSelectionError(messageFor(error));
            }
        } finally {
            if (version === selectionVersion.current) {
                setIsReading(false);
            }
        }
    }, []);

    const changeTitle = useCallback((value: string) => {
        attemptKey.current = null;
        setTitle(value);
    }, []);

    const startAnalysis = useCallback(async () => {
        if (create.isPending || isReading || documents.length === 0) {
            return;
        }

        attemptKey.current ??= dependencies.createId();
        setSelectionError(null);

        try {
            const result = await create.execute({
                title,
                documents,
                idempotencyKey: attemptKey.current,
            });
            setParameters({
                analysisId: result.id,
            });
        } catch (error) {
            setSelectionError(messageFor(error));
        }
    }, [
        create.execute,
        create.isPending,
        dependencies,
        documents,
        isReading,
        setParameters,
        title,
    ]);

    return {
        mode: dependencies.mode,
        schemas,
        analysis,
        analysisId,
        title,
        documents,
        selectionError,
        isReading,
        isCreating: create.isPending,
        canSubmit:
            documents.length > 0 &&
            Boolean(title.trim()) &&
            !isReading &&
            !create.isPending,
        changeTitle,
        selectFiles,
        startAnalysis,
        dismissAnalysis: () => setParameters({}),
    };
}
