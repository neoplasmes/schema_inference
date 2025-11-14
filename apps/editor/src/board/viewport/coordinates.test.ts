import { describe, expect, it } from 'vitest';
import {
    fitBounds,
    levelOfDetail,
    normalizeViewport,
    screenToWorld,
    visibleBounds,
    zoomAt,
} from './coordinates';

describe('camera', () => {
    it('keeps the cursor world point fixed while zooming and clamps unsupported scales', () => {
        const viewport = {
            x: -300,
            y: 170,
            zoom: 0.7,
        };
        const anchor = {
            x: 412,
            y: 280,
        };
        const next = zoomAt(viewport, 50, anchor);

        expect(next.zoom).toBe(3);
        expect(screenToWorld(anchor, next)).toEqual(screenToWorld(anchor, viewport));
        expect(
            normalizeViewport({
                x: NaN,
                y: Infinity,
                zoom: NaN,
            })
        ).toEqual({
            x: 0,
            y: 0,
            zoom: 1,
        });
    });

    it('fits a distant fragment without losing its world origin', () => {
        const next = fitBounds(
            {
                x: -2000,
                y: 500,
                width: 400,
                height: 200,
            },
            800,
            600,
            40
        );

        expect(next.zoom).toBe(1);
        expect(next.x + -1800 * next.zoom).toBe(400);
        expect(next.y + 600 * next.zoom).toBe(300);
    });

    it('expresses the screen margin in world coordinates', () => {
        expect(
            visibleBounds(
                {
                    x: 100,
                    y: 50,
                    zoom: 0.5,
                },
                800,
                600,
                100
            )
        ).toEqual({
            x: -400,
            y: -300,
            width: 2000,
            height: 1600,
        });
    });

    it.each([
        [
            0.3499,
            'overview',
        ],
        [
            0.35,
            'working',
        ],
        [
            1.2,
            'working',
        ],
        [
            1.2001,
            'detailed',
        ],
    ] as const)('uses design LOD boundary %s', (zoom, expected) => {
        expect(levelOfDetail(zoom)).toBe(expected);
    });
});
