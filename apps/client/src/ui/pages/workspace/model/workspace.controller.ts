import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import type { DocumentInput } from '../../../../core/entities';
import { useCommand, useRead } from '../../../../env/cache';
import { useDependencies } from '../../../di';
import { readDocument } from '../lib';

export interface PendingDeletion {
    kind: 'schema' | 'analysis';
    id: string;
}

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
            refetchInterval: current =>
                current?.status === 'completed' || current?.status === 'failed'
                    ? false
                    : 500,
        }
    );
    const analyses = useRead(dependencies.listAnalyses, {});
    const session = useRead(dependencies.getSession, {});
    const create = useCommand(dependencies.createAnalysis);
    const removeSchema = useCommand(dependencies.deleteSchema);
    const removeAnalysis = useCommand(dependencies.deleteAnalysis);
    const endSession = useCommand(dependencies.endSession);
    const [pendingDeletion, setPendingDeletion] = useState<PendingDeletion | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
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

    const requestDeletion = useCallback((deletion: PendingDeletion) => {
        setActionError(null);
        setPendingDeletion(deletion);
    }, []);

    const cancelDeletion = useCallback(() => setPendingDeletion(null), []);

    const confirmDeletion = useCallback(async () => {
        if (!pendingDeletion) {
            return;
        }

        setActionError(null);

        try {
            if (pendingDeletion.kind === 'schema') {
                const schema = schemas.data?.find(item => item.id === pendingDeletion.id);

                if (!schema) {
                    throw new Error(
                        'The schema is no longer available. Refresh the list.'
                    );
                }

                await removeSchema.execute({
                    schemaId: schema.id,
                    revision: schema.revision,
                });
            } else {
                await removeAnalysis.execute({
                    analysisId: pendingDeletion.id,
                });

                if (pendingDeletion.id === analysisId) {
                    setParameters({});
                }
            }

            setPendingDeletion(null);
        } catch (error) {
            setPendingDeletion(null);
            setActionError(messageFor(error));
        }
    }, [
        analysisId,
        pendingDeletion,
        removeAnalysis.execute,
        removeSchema.execute,
        schemas.data,
        setParameters,
    ]);

    const logout = useCallback(async () => {
        setActionError(null);

        try {
            const ended = await endSession.execute({});
            dependencies.navigate(ended.endSessionUrl);
        } catch (error) {
            setActionError(messageFor(error));
        }
    }, [
        dependencies,
        endSession.execute,
    ]);

    return {
        mode: dependencies.mode,
        schemas,
        analyses,
        user: session.data ?? null,
        pendingDeletion,
        isDeleting: removeSchema.isPending || removeAnalysis.isPending,
        isLoggingOut: endSession.isPending,
        actionError,
        requestDeletion,
        cancelDeletion,
        confirmDeletion,
        logout,
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
