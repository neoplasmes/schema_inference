import type { BoardModel } from './types';

export type BoardModelDiff = Readonly<{
    addedCards: readonly string[];
    changedCards: readonly string[];
    removedCards: readonly string[];
    changedConnections: readonly string[];
    removedConnections: readonly string[];
    selectionChanged: boolean;
}>;

export function diffBoardModels(previous: BoardModel, next: BoardModel): BoardModelDiff {
    const oldCards = new Map(previous.cards.map(card => [card.blockId, card]));
    const oldConnections = new Map(previous.connections.map(edge => [edge.id, edge]));
    const addedCards: string[] = [];
    const changedCards: string[] = [];
    const changedConnections: string[] = [];

    for (const card of next.cards) {
        const old = oldCards.get(card.blockId);

        if (!old) {
            addedCards.push(card.blockId);
        } else if (old !== card && JSON.stringify(old) !== JSON.stringify(card)) {
            changedCards.push(card.blockId);
        }

        oldCards.delete(card.blockId);
    }

    for (const edge of next.connections) {
        const old = oldConnections.get(edge.id);

        if (!old || (old !== edge && JSON.stringify(old) !== JSON.stringify(edge))) {
            changedConnections.push(edge.id);
        }

        oldConnections.delete(edge.id);
    }

    return {
        addedCards,
        changedCards,
        removedCards: [...oldCards.keys()],
        changedConnections,
        removedConnections: [...oldConnections.keys()],
        selectionChanged:
            previous.selection?.blockId !== next.selection?.blockId ||
            previous.selection?.memberId !== next.selection?.memberId,
    };
}
