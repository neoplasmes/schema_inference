import { resolveTheme } from '../../theme';
import type { BoardInteractionOptions } from '../contracts';
import { createGestureState, createViewportController } from '../gesture';
import { createRenameController } from '../rename';
import { createPointerController } from '../pointer';
import { createKeyboardController } from '../keyboard';
import { createSelectionController } from './selection_controller';

export function createBoardInteraction(input: BoardInteractionOptions) {
    const options = { ...input, theme: input.theme ?? resolveTheme() };
    const { container } = options;
    const view = container.ownerDocument.defaultView;
    const previous = {
        tabIndex: container.getAttribute('tabindex'),
        touchAction: container.style.touchAction,
        outline: container.style.outline,
        outlineOffset: container.style.outlineOffset,
        cursor: container.style.cursor,
    };
    let disposed = false;
    const gestures = createGestureState();
    const rename = createRenameController(options);
    const selections = createSelectionController(options, rename);
    const viewport = createViewportController(options, rename, gestures);
    const pointer = createPointerController(
        options,
        gestures,
        selections,
        rename,
        viewport,
        previous
    );
    const keyboard = createKeyboardController(
        options,
        gestures,
        selections,
        rename,
        viewport,
        pointer.cancel
    );
    container.tabIndex = 0;
    container.style.touchAction = 'none';

    function blur() {
        pointer.cancel();
        viewport.flush();
        rename.close();
        selections.setHover(null);
        container.style.outline = previous.outline;
    }

    function focusOut(event: FocusEvent) {
        if (!event.relatedTarget || !container.contains(event.relatedTarget as Node)) {
            blur();
        }
    }

    function focus() {
        container.style.outline = `2px solid ${options.theme.color.accent}`;
        container.style.outlineOffset = '-2px';
    }

    container.addEventListener('pointerdown', pointer.pointerDown);
    container.addEventListener('pointermove', pointer.pointerMove);
    container.addEventListener('pointerup', pointer.pointerUp);
    container.addEventListener('pointercancel', pointer.pointerCancel);
    container.addEventListener('lostpointercapture', pointer.pointerCancel);
    container.addEventListener('pointerleave', pointer.leave);
    container.addEventListener('wheel', viewport.wheel, { passive: false });
    container.addEventListener('keydown', keyboard.keyDown);
    container.addEventListener('keyup', keyboard.keyUp);
    container.addEventListener('dblclick', pointer.doubleClick);
    container.addEventListener('focus', focus);
    container.addEventListener('focusout', focusOut);
    view?.addEventListener('blur', blur);

    return {
        modelChanged() {
            selections.syncModel();
            rename.reposition();
            pointer.modelChanged();
        },
        viewportChanged: rename.reposition,
        destroy() {
            if (disposed) {
                return;
            }

            disposed = true;
            pointer.destroy();
            rename.close();
            viewport.destroy();
            container.removeEventListener('pointerdown', pointer.pointerDown);
            container.removeEventListener('pointermove', pointer.pointerMove);
            container.removeEventListener('pointerup', pointer.pointerUp);
            container.removeEventListener('pointercancel', pointer.pointerCancel);
            container.removeEventListener('lostpointercapture', pointer.pointerCancel);
            container.removeEventListener('pointerleave', pointer.leave);
            container.removeEventListener('wheel', viewport.wheel);
            container.removeEventListener('keydown', keyboard.keyDown);
            container.removeEventListener('keyup', keyboard.keyUp);
            container.removeEventListener('dblclick', pointer.doubleClick);
            container.removeEventListener('focus', focus);
            container.removeEventListener('focusout', focusOut);
            view?.removeEventListener('blur', blur);

            if (previous.tabIndex === null) {
                container.removeAttribute('tabindex');
            } else {
                container.setAttribute('tabindex', previous.tabIndex);
            }

            container.style.touchAction = previous.touchAction;
            container.style.outline = previous.outline;
            container.style.outlineOffset = previous.outlineOffset;
            container.style.cursor = previous.cursor;
        },
    };
}
