import type { Graphics } from 'pixi.js';
import type { BoardConnectionGeometry } from './types';
import { paint } from './colors';
import type { ResolvedBoardTheme } from './theme';

export function drawConnection(
    graphics: Graphics,
    edge: BoardConnectionGeometry,
    selected: boolean,
    dashed: boolean,
    theme: ResolvedBoardTheme,
    count = 1,
    clear = true
): void {
    if (clear) {
        graphics.clear();
    }
    const { source, target } = edge;
    const bend = Math.max(40, Math.abs(target.x - source.x) / 2);

    if (!dashed) {
        graphics
            .moveTo(source.x, source.y)
            .bezierCurveTo(
                source.x + bend,
                source.y,
                target.x - bend,
                target.y,
                target.x,
                target.y
            );
    } else {
        const steps = Math.min(
            512,
            Math.max(
                32,
                Math.ceil(
                    (Math.abs(target.x - source.x) + Math.abs(target.y - source.y)) / 4
                )
            )
        );
        let distance = 0;
        let previousX = source.x;
        let previousY = source.y;

        for (let index = 0; index <= steps; index += 1) {
            const t = index / steps;
            const u = 1 - t;
            const x =
                u * u * u * source.x +
                3 * u * u * t * (source.x + bend) +
                3 * u * t * t * (target.x - bend) +
                t * t * t * target.x;
            const y =
                u * u * u * source.y +
                3 * u * u * t * source.y +
                3 * u * t * t * target.y +
                t * t * t * target.y;
            distance += Math.hypot(x - previousX, y - previousY);

            if (Math.floor(distance / 4) % 2 === 0 && index > 0) {
                graphics.lineTo(x, y);
            } else {
                graphics.moveTo(x, y);
            }

            previousX = x;
            previousY = y;
        }
    }

    graphics.stroke({
        ...paint(selected ? 'accent' : 'edge', theme),
        width: count > 1 ? Math.min(6, count * 2) : selected ? 2 : 1.5,
        cap: 'round',
    });
}
