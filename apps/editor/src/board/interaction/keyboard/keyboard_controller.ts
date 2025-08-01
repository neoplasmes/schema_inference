import type { BoardSelection } from '../../model';
import { worldToScreen } from '../../viewport';
import type { BoardInteractionOptions } from '../contracts';
import type { SelectionController } from '../controller';
import type { RenameController } from '../rename';
import { sameSelection, type GestureState, type ViewportController } from '../gesture';

export function createKeyboardController(
    options: BoardInteractionOptions,
    gestures: GestureState,
    selections: SelectionController,
    rename: RenameController,
    viewport: ViewportController,
    cancel: () => void
) {
    const { container, renderer, emit, getModel, getViewport } = options;
    const theme = options.theme!;
    const { select, setHover } = selections;
    const setViewport = viewport.set;

    function ensureVisible(target: BoardSelection) {
        if (target.memberId) {
            renderer.revealMember(target.blockId, target.memberId);
        }

        const card = renderer
            .getGeometry()
            .cards.find(card => card.blockId === target.blockId);
        const bounds = target.memberId
            ? card?.rows.find(row => row.memberId === target.memberId)?.bounds
            : card?.header;

        if (!bounds) {
            return;
        }

        const viewport = getViewport();
        const point = worldToScreen(bounds, viewport);
        const right = point.x + bounds.width * viewport.zoom;
        const bottom = point.y + bounds.height * viewport.zoom;
        const dx =
            point.x < 12
                ? 12 - point.x
                : right > container.clientWidth - 12
                  ? container.clientWidth - 12 - right
                  : 0;
        const dy =
            point.y < 12
                ? 12 - point.y
                : bottom > container.clientHeight - 12
                  ? container.clientHeight - 12 - bottom
                  : 0;

        if (dx || dy) {
            setViewport({ ...viewport, x: viewport.x + dx, y: viewport.y + dy });
            emit('viewportChange', getViewport());
        }
    }

    function keyDown(event: KeyboardEvent) {
        if (
            event.target !== container ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.isComposing
        ) {
            return;
        }

        if (event.key === 'Escape') {
            event.preventDefault();
            cancel();
            setHover(null);

            return;
        }

        if (event.key === ' ') {
            event.preventDefault();
            gestures.spacePressed = true;

            return;
        }

        if (gestures.pointers.size) {
            return;
        }

        const keys = [
            'Tab',
            'ArrowUp',
            'ArrowDown',
            'ArrowLeft',
            'ArrowRight',
            'Home',
            'End',
            'Enter',
            'F2',
        ];

        if (!keys.includes(event.key)) {
            return;
        }

        container.style.outline = `2px solid ${theme.color.accent}`;
        container.style.outlineOffset = '-2px';
        const selection = selections.current;
        const model = getModel();
        const card = model.cards.find(card => card.blockId === selection?.blockId);
        const row = card?.rows.find(row => row.memberId === selection?.memberId);

        if (event.key === 'F2' || (event.key === 'Enter' && row && !row.expandable)) {
            event.preventDefault();
            rename.open(selection);

            return;
        }

        if (
            row?.expandable &&
            (event.key === 'Enter' ||
                event.key === 'ArrowLeft' ||
                event.key === 'ArrowRight')
        ) {
            event.preventDefault();
            const expanded =
                event.key === 'Enter' ? !row.expanded : event.key === 'ArrowRight';

            if (expanded !== row.expanded) {
                emit('expand', {
                    blockId: card!.blockId,
                    memberId: row.memberId,
                    expanded,
                });
            }

            return;
        }

        const visibleCards = new Set(
            renderer.getGeometry().cards.map(card => card.blockId)
        );
        const targets = model.cards
            .filter(card => visibleCards.has(card.blockId))
            .flatMap(card => [
                { blockId: card.blockId, memberId: null } as BoardSelection,
                ...(card.collapsed ? [] : card.rows).map(row => ({
                    blockId: card.blockId,
                    memberId: row.memberId,
                })),
            ]);
        const index = targets.findIndex(target => sameSelection(selection, target));
        const backwards =
            event.key === 'ArrowUp' ||
            event.key === 'ArrowLeft' ||
            (event.key === 'Tab' && event.shiftKey);
        let next = index + (backwards ? -1 : 1);

        if (event.key === 'Home') {
            next = 0;
        } else if (event.key === 'End') {
            next = targets.length - 1;
        } else if (event.key === 'Enter') {
            next = Math.min(index + 1, targets.length - 1);
        } else if (index < 0) {
            next = backwards ? targets.length - 1 : 0;
        }

        if (event.key === 'Tab' && (next < 0 || next >= targets.length)) {
            return;
        }

        event.preventDefault();
        const target = targets[Math.min(targets.length - 1, Math.max(0, next))];

        if (target) {
            select(target);
            ensureVisible(target);
        }
    }

    function keyUp(event: KeyboardEvent) {
        if (event.key === ' ') {
            gestures.spacePressed = false;
        }
    }

    return { keyDown, keyUp };
}
