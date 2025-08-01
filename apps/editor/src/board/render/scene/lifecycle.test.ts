import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ init: null as null | (() => void), destroy: vi.fn() }));

vi.mock('pixi.js', () => ({
    Application: class {
        init() {
            return new Promise<void>(resolve => {
                state.init = resolve;
            });
        }
        destroy = state.destroy;
    },
    Container: class {},
    Graphics: class {},
    Sprite: class {},
    NineSliceSprite: class {},
    Text: class {},
    TextStyle: class {},
    Texture: class {},
}));

import { createBoardRenderer } from './create_board_renderer';

afterEach(() => {
    vi.unstubAllGlobals();
    state.destroy.mockClear();
    state.init = null;
});

function setup(fonts: Promise<void> = Promise.resolve()) {
    vi.stubGlobal('window', { devicePixelRatio: 2 });
    vi.stubGlobal('document', { fonts: { ready: fonts } });
    const appendChild = vi.fn();
    const renderer = createBoardRenderer({
        container: {
            clientWidth: 800,
            clientHeight: 600,
            appendChild,
        } as unknown as HTMLElement,
    });

    return { renderer, appendChild };
}

describe('asynchronous renderer disposal', () => {
    it('destroys the initialized Pixi application once when disposed before init resolves', async () => {
        const { renderer, appendChild } = setup();
        renderer.destroy();
        renderer.destroy();
        state.init!();
        await renderer.ready;

        expect(state.destroy).toHaveBeenCalledExactlyOnceWith(true, { children: true });
        expect(appendChild).not.toHaveBeenCalled();
        expect(renderer.getStats().renderedFrames).toBe(0);
    });

    it('does not append a stale canvas when disposed while waiting for fonts', async () => {
        let finishFonts!: () => void;
        const { renderer, appendChild } = setup(
            new Promise<void>(resolve => {
                finishFonts = resolve;
            })
        );
        state.init!();
        await Promise.resolve();
        renderer.destroy();
        expect(state.destroy).toHaveBeenCalledTimes(1);
        finishFonts();
        await renderer.ready;

        expect(state.destroy).toHaveBeenCalledTimes(1);
        expect(appendChild).not.toHaveBeenCalled();
    });
});
