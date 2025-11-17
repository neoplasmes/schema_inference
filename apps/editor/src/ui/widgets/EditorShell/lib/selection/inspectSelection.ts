import type { BoardModel } from '../../../../../board';

export function inspectSelection(model: BoardModel) {
    const selected = model.cards.find(card => card.blockId === model.selection?.blockId);
    const selectedRow = selected?.rows.find(
        row => row.memberId === model.selection?.memberId
    );
    const connection = model.connections.find(
        edge =>
            edge.sourceBlockId === selected?.blockId &&
            edge.sourceMemberId === selectedRow?.memberId
    );
    const inspected =
        model.cards.find(card => card.blockId === connection?.targetBlockId) ?? selected;
    const variants = inspected?.variants;
    const activeVariant =
        variants?.find(variant => variant.variantId === inspected?.activeVariantId) ??
        variants?.[0];
    const currentName = selectedRow?.name ?? inspected?.title;
    const path =
        selectedRow && selected
            ? `${selected.title} / ${selectedRow.name}`
            : inspected?.title;

    return {
        selected,
        selectedRow,
        inspected,
        variants,
        activeVariant,
        currentName,
        path,
    };
}
