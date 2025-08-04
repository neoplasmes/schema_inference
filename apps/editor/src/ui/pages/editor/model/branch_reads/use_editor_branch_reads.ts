import type { BoardEventMap } from '../../../../../board';
import { observedPreview } from '../../lib/evidence';
import { errorText } from '../../lib/errors';
import { memberInDocument } from '../../lib/projection';
import {
    expandedMembers,
    integrate,
    type EditorSessionState,
    type Session,
} from '../session';

export function useEditorBranchReads(
    state: EditorSessionState,
    mutate: (action: (target: Session) => void) => void
) {
    const { sessionRef, epoch, reads, demo, setMessage, refresh } = state;

    async function expand(
        blockId: string,
        memberId: string,
        expanded: boolean
    ): Promise<void> {
        const target = sessionRef.current;

        if (!target) {
            return;
        }

        const key = `${blockId}/${memberId}`;

        if (demo && observedPreview(target.view, target.template, blockId)) {
            target.view.expanded.set(key, expanded);
            refresh();

            return;
        }

        reads.current.get(key)?.abort();
        target.view.expanded.set(key, expanded);
        refresh();

        if (
            !expanded ||
            target.view.connections.some(
                connection =>
                    connection.sourceBlockId === blockId &&
                    connection.sourceMemberId === memberId
            )
        ) {
            return;
        }

        const row = memberInDocument(target.document, memberId);

        if (!row) {
            setMessage('Load this field before expanding it.');

            return;
        }

        const generation = epoch.current;
        const snapshot = target.document.manifest.snapshot;
        const variant = target.view.variants.get(blockId);
        const controller = new AbortController();
        reads.current.set(key, controller);

        try {
            const branch = await target.dependencies.loadBranch.execute(
                { snapshot, nodeId: row.member.valueNodeId },
                { signal: controller.signal }
            );

            if (
                controller.signal.aborted ||
                epoch.current !== generation ||
                sessionRef.current !== target ||
                target.document.manifest.snapshot.revision !== snapshot.revision ||
                target.view.expanded.get(key) !== true ||
                target.view.variants.get(blockId) !== variant
            ) {
                return;
            }

            const childId = row.member.valueNodeId;
            integrate(target, branch, childId);
            target.view.connections.push({
                id: key,
                sourceBlockId: blockId,
                sourceMemberId: memberId,
                targetBlockId: childId,
                kind: 'containment',
                state: 'normal',
            });
            refresh();
        } catch (reason) {
            if (
                !controller.signal.aborted &&
                epoch.current === generation &&
                sessionRef.current === target &&
                target.document.manifest.snapshot.revision === snapshot.revision &&
                target.view.variants.get(blockId) === variant
            ) {
                target.view.expanded.set(key, false);
                setMessage(errorText(reason));
                refresh();
            }
        } finally {
            if (reads.current.get(key) === controller) {
                reads.current.delete(key);
            }
        }
    }

    async function rename(input: BoardEventMap['rename']): Promise<void> {
        const target = sessionRef.current;

        if (
            target &&
            demo &&
            observedPreview(target.view, target.template, input.blockId)
        ) {
            setMessage(
                'This is an observed variant preview. Return to the draft variant to edit fields.'
            );

            return;
        }

        const row = target && memberInDocument(target.document, input.memberId);

        if (!target || !row) {
            setMessage('Load this field before renaming it.');

            return;
        }

        const generation = epoch.current;
        const snapshot = target.document.manifest.snapshot;
        const variant = target.view.variants.get(input.blockId);

        try {
            if (
                row.member.kind === 'xmlParticle' &&
                !target.document.nodes.has(row.member.valueNodeId)
            ) {
                const key = `rename/${input.memberId}`;
                reads.current.get(key)?.abort();
                const controller = new AbortController();
                reads.current.set(key, controller);
                const node = await target.dependencies.readNode.execute(
                    { snapshot, nodeId: row.member.valueNodeId },
                    { signal: controller.signal }
                );

                if (
                    controller.signal.aborted ||
                    generation !== epoch.current ||
                    sessionRef.current !== target ||
                    target.document.manifest.snapshot.revision !== snapshot.revision ||
                    target.view.variants.get(input.blockId) !== variant
                ) {
                    return;
                }

                target.document.integrateNode(node);
            }

            mutate(current => current.document.rename(input.memberId, input.name));
        } catch (reason) {
            if (generation === epoch.current && sessionRef.current === target) {
                setMessage(errorText(reason));
            }
        }
    }

    async function loadMore(input: BoardEventMap['loadMore']): Promise<void> {
        const target = sessionRef.current;
        const window = target?.document.collections.get(input.collectionId);

        if (!target || !window || window.state === 'loading') {
            return;
        }

        const generation = epoch.current;
        const snapshot = target.document.manifest.snapshot;
        const variant = target.view.variants.get(input.blockId);
        const key = `page/${input.collectionId}`;
        reads.current.get(key)?.abort();
        const controller = new AbortController();
        reads.current.set(key, controller);
        const loadingWindow = target.document.setCollectionLoadState(
            input.collectionId,
            'loading'
        );
        refresh();

        try {
            const page = await target.dependencies.readMembers.execute(
                { snapshot, collectionId: input.collectionId, cursor: window.nextCursor },
                { signal: controller.signal }
            );

            if (
                controller.signal.aborted ||
                epoch.current !== generation ||
                sessionRef.current !== target ||
                target.document.manifest.snapshot.revision !== snapshot.revision ||
                target.view.variants.get(input.blockId) !== variant
            ) {
                return;
            }

            target.document.addPage(page, 'append', expandedMembers(target));
            refresh();
        } catch (reason) {
            if (
                !controller.signal.aborted &&
                epoch.current === generation &&
                sessionRef.current === target &&
                target.document.manifest.snapshot.revision === snapshot.revision &&
                target.view.variants.get(input.blockId) === variant
            ) {
                target.document.setCollectionLoadState(
                    input.collectionId,
                    'failed',
                    errorText(reason)
                );
                refresh();
            }
        } finally {
            if (reads.current.get(key) === controller) {
                reads.current.delete(key);
            }

            if (
                target.document.collections.get(input.collectionId) === loadingWindow &&
                epoch.current === generation &&
                sessionRef.current === target
            ) {
                target.document.setCollectionLoadState(
                    input.collectionId,
                    window.state,
                    window.error
                );
                refresh();
            }
        }
    }

    return { expand, rename, loadMore };
}
