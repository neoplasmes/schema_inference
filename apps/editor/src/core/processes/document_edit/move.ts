import { DocumentEditError } from './document_edit.error';
import { nodeCollections } from '../../entities/schema';
import type { DocumentEdit, DocumentEditState } from './contracts';
import { checkMoveAncestry } from './ancestry';
import { findMember } from './members';

/** Preserves field-kind containment and known sibling order so every move has a valid inverse. */
export function createMoveEdit(
    state: DocumentEditState,
    memberId: string,
    targetCollectionId: string,
    beforeMemberId: string | null
): DocumentEdit | null {
    const windows = state.collections;
    const found = findMember(windows, memberId);
    const target = windows.get(targetCollectionId);

    if (!found || !target || !target.available) {
        throw new DocumentEditError('Load both collections before moving a field.');
    }

    if (!found.window.contiguous || !target.contiguous) {
        throw new DocumentEditError(
            'Load a contiguous field window before reordering pinned edits across unloaded rows.'
        );
    }

    if (beforeMemberId === memberId) {
        return null;
    }

    if (
        beforeMemberId !== null &&
        !target.items.some(row => row.member.id === beforeMemberId)
    ) {
        throw new DocumentEditError('The destination field is not loaded.');
    }

    const owner = [...state.nodes.values()].find(node =>
        nodeCollections(node).some(collection => collection.id === targetCollectionId)
    );
    const allowed =
        owner &&
        ((owner.kind === 'object' && found.row.member.kind === 'property') ||
            (owner.kind === 'xmlComplex' && found.row.member.kind === 'xmlAttribute') ||
            (owner.kind === 'xmlGroup' && found.row.member.kind === 'xmlParticle') ||
            (owner.kind === 'union' && found.row.member.kind === 'option'));

    if (!allowed) {
        throw new DocumentEditError('This collection cannot contain that kind of field.');
    }

    if (
        targetCollectionId !== found.window.collectionId &&
        found.row.valueSummary.kind !== 'scalar' &&
        found.row.valueSummary.kind !== 'ref'
    ) {
        checkMoveAncestry(state, found.row.member.valueNodeId, owner.id);
    }

    const index = found.window.items.findIndex(row => row.member.id === memberId);
    const next = found.window.items[index + 1]?.member.id ?? null;

    if (next === null && !found.window.complete) {
        throw new DocumentEditError(
            'Load the next page to preserve the original field order for undo.'
        );
    }

    return {
        forward: { kind: 'moveMember', memberId, targetCollectionId, beforeMemberId },
        inverse: {
            kind: 'moveMember',
            memberId,
            targetCollectionId: found.window.collectionId,
            beforeMemberId: next,
        },
    };
}
