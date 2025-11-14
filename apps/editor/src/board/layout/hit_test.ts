import type { Point } from '../model';
import type { BoardCardGeometry, BoardHit } from '../render/contracts';
import { contains } from './spatial_index';

/** Later cards and more specific regions take precedence, matching the scene order. */
export function hitTestCards(
    candidates: readonly BoardCardGeometry[],
    point: Point
): BoardHit | null {
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
        const card = candidates[index];

        for (
            let regionIndex = card.regions.length - 1;
            regionIndex >= 0;
            regionIndex -= 1
        ) {
            const region = card.regions[regionIndex];

            if (contains(region.bounds, point.x, point.y)) {
                return region.target;
            }
        }

        if (contains(card.bounds, point.x, point.y)) {
            return {
                kind: 'header',
                blockId: card.blockId,
            };
        }
    }

    return null;
}
