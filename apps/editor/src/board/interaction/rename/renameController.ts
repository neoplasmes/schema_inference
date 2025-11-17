import type { BoardSelection } from '../../model';
import type { BoardInteractionOptions } from '../contracts';
import { createRenameInput } from './renameInput';

export function createRenameController(options: BoardInteractionOptions) {
    const { container, renderer, emit, getModel, getViewport } = options;
    let input: ReturnType<typeof createRenameInput> | null = null;

    function open(target: BoardSelection | null) {
        if (!target?.memberId) {
            return;
        }

        const card = getModel().cards.find(card => card.blockId === target.blockId);
        const row = card?.rows.find(row => row.memberId === target.memberId);

        if (!row || row.change === 'removed') {
            return;
        }

        renderer.revealMember(target.blockId, target.memberId);
        close();
        const memberId = target.memberId;
        input = createRenameInput({
            theme: options.theme,
            container,
            selection: {
                blockId: target.blockId,
                memberId,
            },
            name: row.name,
            geometry: () => renderer.getGeometry(),
            viewport: getViewport,
            confirm: name =>
                emit('rename', {
                    blockId: target.blockId,
                    memberId,
                    name,
                }),
            closed: () => {
                input = null;
            },
        });
    }

    function close() {
        input?.destroy();
        input = null;
    }

    return {
        open,
        close,
        reposition: () => input?.reposition(),
        element: () => container.querySelector('[data-board-rename]'),
    };
}

export type RenameController = ReturnType<typeof createRenameController>;
