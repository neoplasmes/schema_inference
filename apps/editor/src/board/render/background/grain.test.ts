import { expect, it } from 'vitest';
import { grainPixels } from './grain';

it('keeps stable low-opacity grain with neighboring-pixel correlation instead of enlarged blocks', () => {
    const size = 256;
    const pixels = grainPixels(size);
    let total = 0;
    let color = 0;
    let firstDifference = 0;
    let secondDifference = 0;

    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            const index = (y * size + x) * 4;
            const alpha = pixels[index + 3];
            total += alpha;
            color |= pixels[index] | pixels[index + 1] | pixels[index + 2];

            if (x + 2 < size) {
                firstDifference += Math.abs(alpha - pixels[index + 7]);
                secondDifference += Math.abs(alpha - pixels[index + 11]);
            }
        }
    }

    expect(color).toBe(0);
    expect(total / (size * size)).toBeCloseTo(255 * 0.025, 1);
    expect(secondDifference / firstDifference).toBeGreaterThan(1.15);
    expect(secondDifference / firstDifference).toBeLessThan(1.45);
    expect(pixels).toEqual(grainPixels(size));
});
