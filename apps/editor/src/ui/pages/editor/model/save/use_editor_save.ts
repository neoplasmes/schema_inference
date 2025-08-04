import {
    SchemaWriteRejectedError,
    type ChangeReceipt,
} from '../../../../../app/ports/repos/schema';
import { errorText } from '../../lib/errors';
import type { EditorProps } from '../resource';
import type { EditorSessionState, Session } from '../session';

export function useEditorSave(props: EditorProps, state: EditorSessionState) {
    const {
        sessionRef,
        epoch,
        drafts,
        reads,
        busy,
        saveBlocked,
        demo,
        resourceKey,
        setBusy,
        setMessage,
        setSaveBlocked,
        refresh,
        callbacks,
    } = state;

    async function save(): Promise<void> {
        const target = sessionRef.current;

        if (!target || busy || saveBlocked || target.document.operations.length === 0) {
            return;
        }

        const generation = epoch.current;
        const mutationId = crypto.randomUUID();
        setBusy(true);
        setMessage(null);

        try {
            let receipt = await target.dependencies.saveSchema.execute({
                document: target.document,
                mutationId,
            });

            if (generation !== epoch.current || target !== sessionRef.current) {
                return;
            }

            const poll = new AbortController();
            reads.current.set('save-poll', poll);

            for (let count = 0; receipt.status === 'pending' && count < 40; count += 1) {
                await new Promise<void>(resolve => window.setTimeout(resolve, 500));

                if (
                    poll.signal.aborted ||
                    generation !== epoch.current ||
                    target !== sessionRef.current
                ) {
                    return;
                }

                const next = await target.dependencies.readChange.execute(
                    {
                        schemaId: target.document.manifest.snapshot.id,
                        changeId: receipt.id,
                    },
                    { signal: poll.signal }
                );

                if (
                    next.id !== receipt.id ||
                    next.clientMutationId !== receipt.clientMutationId
                ) {
                    throw new Error(
                        'The server returned another changeset. Your local edits are preserved.'
                    );
                }

                receipt = next;
            }

            if (generation !== epoch.current || target !== sessionRef.current) {
                return;
            }

            finishSave(target, receipt, demo);
            refresh();
        } catch (reason) {
            if (generation === epoch.current && target === sessionRef.current) {
                if (
                    reason instanceof SchemaWriteRejectedError &&
                    reason.reason === 'conflict'
                ) {
                    setSaveBlocked(true);
                }

                setMessage(errorText(reason));
                refresh();
            }
        } finally {
            if (generation === epoch.current) {
                setBusy(false);
            }
        }
    }

    function finishSave(target: Session, receipt: ChangeReceipt, local: boolean): void {
        if (receipt.status === 'applied' && receipt.revision !== null) {
            if (target.document.manifest.snapshot.revision !== receipt.revision) {
                target.document.confirmSave(receipt.revision, receipt.clientMutationId);
            }

            setMessage(
                local
                    ? 'Saved locally in this demo session.'
                    : 'The server applied your changes.'
            );

            if (!local) {
                if (props.resource.kind === 'analysis') {
                    drafts.current.set(
                        resourceKey,
                        Promise.resolve(target.document.manifest)
                    );
                }

                callbacks.current.onSaved?.({
                    schemaId: target.document.manifest.snapshot.id,
                    revision: receipt.revision,
                    savedAt: new Date().toISOString(),
                });
            }
        } else if (receipt.status === 'pending') {
            setMessage(
                'The server is still processing this save. Retry to check the same changeset.'
            );
        } else {
            if (receipt.status === 'conflicted') {
                setSaveBlocked(true);
            }

            target.document.failSave(receipt.clientMutationId);
            setMessage(
                receipt.error ??
                    'The server could not apply these changes. Your local edits are preserved; reconcile before retrying.'
            );
        }
    }

    return { save };
}
