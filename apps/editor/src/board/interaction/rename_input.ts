import type { BoardSelection, BoardViewport } from '../model/types';
import type { BoardGeometry } from '../render/types';
import { resolveTheme, themeRadius, type ResolvedBoardTheme } from '../render/theme';
import { worldToScreen } from '../viewport/coordinates';

type RenameInputOptions = {
    container: HTMLElement;
    selection: BoardSelection & { memberId: string };
    name: string;
    geometry: () => BoardGeometry;
    viewport: () => BoardViewport;
    confirm: (name: string) => void;
    closed: () => void;
    theme?: ResolvedBoardTheme;
};

export function createRenameInput(options: RenameInputOptions) {
    const input = options.container.ownerDocument.createElement('input');
    const { selection } = options;
    const theme = options.theme ?? resolveTheme();
    let composing = false;
    let destroyed = false;

    input.type = 'text';
    input.value = options.name;
    input.setAttribute('aria-label', 'Field name');
    input.dataset.boardRename = 'true';
    Object.assign(input.style, {
        position: 'absolute',
        zIndex: '1',
        boxSizing: 'border-box',
        border: '0',
        borderRadius: `${themeRadius(theme, 'radius-sm')}px`,
        background: theme.color['surface-card'],
        color: theme.color.label,
        outline: 'none',
        boxShadow: theme.shadow['shadow-thumb'],
        fontFamily: theme.font.sans,
        fontWeight: theme.text.body.fontWeight,
        padding: '0 8px',
        transformOrigin: 'top left',
    });

    function close(restoreFocus: boolean) {
        if (destroyed) {
            return;
        }

        destroyed = true;
        input.removeEventListener('keydown', keydown);
        input.removeEventListener('compositionstart', compositionStart);
        input.removeEventListener('compositionend', compositionEnd);
        input.removeEventListener('blur', blur);
        input.remove();
        options.closed();

        if (restoreFocus) {
            options.container.focus({ preventScroll: true });
        }
    }

    function keydown(event: KeyboardEvent) {
        event.stopPropagation();

        if (event.key === 'Escape') {
            event.preventDefault();
            close(true);
        } else if (
            event.key === 'Enter' &&
            !composing &&
            !event.isComposing &&
            event.keyCode !== 229
        ) {
            event.preventDefault();
            const name = input.value.trim();
            close(true);

            if (name && name !== options.name) {
                options.confirm(name);
            }
        }
    }

    function compositionStart() {
        composing = true;
    }

    function compositionEnd() {
        composing = false;
    }

    function blur() {
        close(false);
    }

    function reposition() {
        if (destroyed) {
            return;
        }

        const row = options
            .geometry()
            .cards.find(card => card.blockId === selection.blockId)
            ?.rows.find(row => row.memberId === selection.memberId);

        if (!row) {
            close(false);

            return;
        }

        const viewport = options.viewport();
        const bounds = row.nameBounds ?? row.bounds;
        const point = worldToScreen(bounds, viewport);
        Object.assign(input.style, {
            left: `${point.x}px`,
            top: `${point.y}px`,
            width: `${bounds.width}px`,
            height: `${bounds.height}px`,
            fontSize: theme.text.body.fontSize,
            transform: `scale(${viewport.zoom})`,
        });
    }

    input.addEventListener('keydown', keydown);
    input.addEventListener('compositionstart', compositionStart);
    input.addEventListener('compositionend', compositionEnd);
    input.addEventListener('blur', blur);
    options.container.append(input);
    reposition();

    if (!destroyed) {
        input.focus({ preventScroll: true });
        input.select();
    }

    return { reposition, destroy: () => close(false) };
}
