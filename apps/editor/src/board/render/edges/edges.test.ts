import { expect, it, vi } from 'vitest';
import type { Graphics } from 'pixi.js';
import { drawConnection } from './edges';
import { resolveTheme } from '../../theme';

it('appends several edges into the same retained layer without clearing earlier paths', () => {
    const graphics = {
        clear: vi.fn(),
        moveTo: vi.fn().mockReturnThis(),
        lineTo: vi.fn().mockReturnThis(),
        bezierCurveTo: vi.fn().mockReturnThis(),
        stroke: vi.fn().mockReturnThis(),
    };
    const edge = {
        id: 'first',
        source: {
            x: 0,
            y: 0,
        },
        target: {
            x: 300,
            y: 100,
        },
        sourceHidden: false,
        bounds: {
            x: 0,
            y: 0,
            width: 300,
            height: 100,
        },
    };
    const layer = graphics as unknown as Graphics;
    drawConnection(layer, edge, false, false, resolveTheme(), 1, false);
    drawConnection(
        layer,
        {
            ...edge,
            id: 'second',
        },
        true,
        false,
        resolveTheme(),
        1,
        false
    );

    expect(graphics.clear).not.toHaveBeenCalled();
    expect(graphics.bezierCurveTo).toHaveBeenCalledTimes(2);
    expect(graphics.stroke).toHaveBeenCalledTimes(2);
});
