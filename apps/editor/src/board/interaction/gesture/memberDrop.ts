import type { BoardEventMap, Point } from '../../model';
import type { BoardInteractionOptions } from '../contracts';
import type { Gesture } from './gestureState';

export function memberDropAt(
    options: BoardInteractionOptions,
    gesture: Gesture | null,
    point: Point
): BoardEventMap['move'] | null {
    const { renderer, getModel } = options;
    const source = gesture?.hit;

    if (source?.kind !== 'row') {
        return null;
    }

    const model = getModel();
    const sourceCard = model.cards.find(card => card.blockId === source.blockId);
    const sourceRow = sourceCard?.rows.find(row => row.memberId === source.memberId);
    const hit = renderer.hitTest(point);
    const targetGeometry = renderer
        .queryCards({
            ...point,
            width: 0.01,
            height: 0.01,
        })
        .find(card => !hit || card.blockId === hit.blockId);
    const target = model.cards.find(card => card.blockId === targetGeometry?.blockId);

    if (
        !sourceRow ||
        sourceRow.change === 'removed' ||
        !target?.collectionId ||
        target.collapsed ||
        (target.rowWindow.state !== 'complete' && target.rowWindow.state !== 'partial')
    ) {
        return null;
    }

    if (
        target.blockId !== source.blockId &&
        target.rows.some(
            row => (row.icon === 'attribute') !== (sourceRow.icon === 'attribute')
        )
    ) {
        return null;
    }

    if (!gesture!.blockedBlocks) {
        const children = new Map<string, string[]>();
        const descendants = new Set<string>();

        for (const connection of model.connections) {
            const targets = children.get(connection.sourceBlockId) ?? [];
            targets.push(connection.targetBlockId);
            children.set(connection.sourceBlockId, targets);

            if (
                connection.sourceBlockId === source.blockId &&
                connection.sourceMemberId === source.memberId
            ) {
                descendants.add(connection.targetBlockId);
            }
        }

        for (const blockId of descendants) {
            for (const targetId of children.get(blockId) ?? []) {
                descendants.add(targetId);
            }
        }

        gesture!.blockedBlocks = descendants;
    }

    if (gesture!.blockedBlocks.has(target.blockId)) {
        return null;
    }

    const rows = targetGeometry?.rows ?? [];
    const before =
        rows.find(row => point.y < row.bounds.y + row.bounds.height / 2)?.memberId ??
        null;

    if (target.blockId === source.blockId) {
        const index = sourceCard!.rows.findIndex(row => row.memberId === source.memberId);
        const next = sourceCard!.rows[index + 1]?.memberId ?? null;

        if (before === source.memberId || before === next) {
            return null;
        }
    }

    if (before === null && target.rowWindow.hasMore) {
        return null;
    }

    return {
        kind: 'member',
        memberId: source.memberId,
        sourceBlockId: source.blockId,
        targetBlockId: target.blockId,
        targetCollectionId: target.collectionId,
        beforeMemberId: before,
    };
}
