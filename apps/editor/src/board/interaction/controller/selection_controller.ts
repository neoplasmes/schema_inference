import type { BoardSelection } from '../../model';
import type { BoardHit } from '../../render';
import type { BoardInteractionOptions } from '../contracts';
import type { RenameController } from '../rename';
import { hitSelection, sameSelection } from '../gesture';

export function createSelectionController(
    options: BoardInteractionOptions,
    rename: RenameController
) {
    const { renderer, emit, getModel } = options;
    let selection = getModel().selection;
    let hover: BoardSelection | null = null;

    function select(next: BoardSelection | null) {
        selection = next;
        emit('select', next);
    }

    function setHover(next: BoardSelection | null) {
        if (sameSelection(hover, next)) {
            return;
        }

        hover = next;
        renderer.setHover(next);
        emit('hover', next);
    }

    function activate(hit: BoardHit | null) {
        if (!hit) {
            select(null);

            return;
        }

        select(hitSelection(hit));

        if (hit.kind === 'boundary') {
            renderer.revealMember(hit.blockId, hit.memberId);
            rename.reposition();
        } else if (hit.kind === 'expand') {
            const row = getModel()
                .cards.find(card => card.blockId === hit.blockId)
                ?.rows.find(row => row.memberId === hit.memberId);

            if (row?.expandable) {
                emit('expand', {
                    blockId: hit.blockId,
                    memberId: hit.memberId,
                    expanded: !row.expanded,
                });
            }
        } else if (hit.kind === 'variant') {
            emit('variantChange', {
                blockId: hit.blockId,
                variantId: hit.variantId,
                scopeId: hit.scopeId,
            });
        } else if (hit.kind === 'add') {
            emit('add', {
                blockId: hit.blockId,
                collectionId: hit.collectionId,
            });
        } else if (hit.kind === 'more') {
            const card = getModel().cards.find(card => card.blockId === hit.blockId);

            if (
                card &&
                card.rowWindow.state !== 'loading' &&
                (card.rowWindow.hasMore ||
                    card.rowWindow.state === 'failed' ||
                    card.rowWindow.state === 'notRequested')
            ) {
                emit('loadMore', {
                    blockId: hit.blockId,
                    collectionId: hit.collectionId,
                });
            }
        }
    }

    return {
        select,
        setHover,
        activate,
        get current() {
            return selection;
        },
        syncModel() {
            selection = getModel().selection;
        },
    };
}

export type SelectionController = ReturnType<typeof createSelectionController>;
