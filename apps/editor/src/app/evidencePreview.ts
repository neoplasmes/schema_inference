import { getScene } from '../../playground/scenes';
import type { BoardModel } from '../board';
import type { EditorView } from './projection';

export function observedPreview(
    view: EditorView,
    template: BoardModel,
    blockId: string
): boolean {
    if (
        blockId === 'observed-bank' ||
        template.connections.some(
            connection =>
                connection.kind === 'preview' &&
                (connection.sourceBlockId === blockId ||
                    connection.targetBlockId === blockId)
        )
    ) {
        return true;
    }

    const selected = view.variants.get(blockId);
    const initial = template.cards.find(
        card => card.blockId === blockId
    )?.activeVariantId;

    return selected !== undefined && selected !== initial;
}

/** The demo evidence is a separate projection; it never becomes the editable draft. */
export function projectEvidence(
    model: BoardModel,
    view: EditorView,
    template: BoardModel
): BoardModel {
    const selected = view.variants.get('payment');

    if (selected === undefined || !observedPreview(view, template, 'payment')) {
        return model;
    }

    const current = model.cards.find(card => card.blockId === 'payment');

    if (!current) {
        return model;
    }

    const evidence = getScene(selected === 'invoice' ? 'variants' : 'main').board;
    const payment = evidence.cards.find(card => card.blockId === 'payment');

    if (!payment) {
        return model;
    }

    const cards = model.cards
        .filter(card => card.blockId !== 'bank')
        .map(card =>
            card.blockId === 'payment'
                ? {
                      ...card,
                      rows: payment.rows,
                      activeVariantId: selected,
                      subtitle: `Viewing ${selected === 'invoice' ? 'Invoice' : 'Card'} · read only`,
                      rowWindow: payment.rowWindow,
                  }
                : card
        );
    let connections = model.connections.filter(
        connection => connection.sourceBlockId !== 'payment'
    );
    const bank = evidence.cards.find(card => card.blockId === 'bank');

    if (bank && view.expanded.get('payment/bank') !== false) {
        cards.push({
            ...bank,
            blockId: 'observed-bank',
            position: template.connections.some(
                connection => connection.kind === 'preview'
            )
                ? bank.position
                : current.position
                  ? {
                        x: current.position.x + (current.width ?? 268) + 80,
                        y: current.position.y + 180,
                    }
                  : undefined,
        });
        connections = [
            ...connections,
            {
                id: 'observed/payment/bank',
                sourceBlockId: 'payment',
                sourceMemberId: 'bank',
                targetBlockId: 'observed-bank',
                kind: 'preview',
                state: 'normal',
            },
        ];
    }

    return { ...model, cards, connections };
}
