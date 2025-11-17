import type { BoardSelection } from '../../../../../board';
import { collectionForMember } from '../../lib/collections';
import { observedPreview } from '../../lib/evidence';
import { errorText } from '../../lib/errors';
import { memberInDocument } from '../../lib/projection';
import { useEditorBranchReads } from '../branchReads';
import type { BoardHandlers } from '../schemaBoard';
import { projectSession, type EditorSessionState, type Session } from '../session';

export function useEditorIntents(state: EditorSessionState) {
    const { sessionRef, demo, saveBlocked, setMessage, refresh } = state;

    function mutate(action: (target: Session) => void): void {
        const current = sessionRef.current;

        if (!current) {
            return;
        }

        try {
            action(current);

            if (!saveBlocked) {
                setMessage(null);
            }

            refresh();
        } catch (reason) {
            setMessage(errorText(reason));
        }
    }

    function select(selection: BoardSelection | null): void {
        mutate(target => {
            target.view.selection = selection;
        });
    }

    const { expand, rename, loadMore } = useEditorBranchReads(state, mutate);

    const handlers: BoardHandlers = {
        select,
        rename: input => {
            void rename(input);
        },
        move: input =>
            mutate(target => {
                if (input.kind === 'card') {
                    target.view.positions.set(input.blockId, input.position);

                    return;
                }

                if (
                    demo &&
                    (observedPreview(target.view, target.template, input.sourceBlockId) ||
                        observedPreview(
                            target.view,
                            target.template,
                            input.targetBlockId
                        ))
                ) {
                    throw new Error(
                        'Observed variant fields are read only. Return to the draft variant before moving fields.'
                    );
                }

                const row = memberInDocument(target.document, input.memberId);
                let collectionId = input.targetCollectionId;

                const model = projectSession({
                    session: target,
                    version: state.version,
                    error: state.error,
                    demo,
                });
                const destination = model.cards.find(
                    card => card.blockId === input.targetBlockId
                );

                if (row && destination) {
                    collectionId =
                        collectionForMember(
                            target.document,
                            destination.nodeId,
                            row.member.kind
                        ) ?? collectionId;
                }

                target.document.move(input.memberId, collectionId, input.beforeMemberId);
            }),
        expand: input => {
            void expand(input.blockId, input.memberId, input.expanded);
        },
        loadMore: input => {
            void loadMore(input);
        },
        add: () =>
            setMessage(
                'Adding new schema nodes is unavailable in this editor. Loaded fields can be renamed and moved.'
            ),
        variantChange: input =>
            mutate(target => {
                const model = projectSession({
                    session: target,
                    version: state.version,
                    error: state.error,
                    demo,
                });
                const card = model.cards.find(card => card.blockId === input.blockId);

                if (
                    !card?.variants?.some(
                        variant =>
                            variant.variantId === input.variantId &&
                            variant.scopeId === input.scopeId
                    )
                ) {
                    throw new Error(
                        'This variant does not belong to the displayed context.'
                    );
                }

                target.view.variants.set(input.blockId, input.variantId);
            }),
        hover: () => undefined,
        viewportChange: () => undefined,
    };

    return {
        handlers,
        select,
        expand,
        undo: () => mutate(target => target.document.undo()),
        redo: () => mutate(target => target.document.redo()),
    };
}
