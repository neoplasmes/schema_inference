/** Correlated device-pixel grain preserves mean opacity without enlarged pixel blocks. */
export function grainPixels(size: number): Uint8ClampedArray {
    const source = new Uint8Array(size * size);
    const pixels = new Uint8ClampedArray(size * size * 4);
    let seed = 1729;

    for (let index = 0; index < source.length; index += 1) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        source[index] = seed >>> 24;
    }

    for (let y = 0; y < size; y += 1) {
        const previousY = (y + size - 1) % size;

        for (let x = 0; x < size; x += 1) {
            const previousX = (x + size - 1) % size;
            const value =
                (source[y * size + x] +
                    source[y * size + previousX] * 0.5 +
                    source[previousY * size + x] * 0.5 +
                    source[previousY * size + previousX] * 0.25) /
                (255 * 2.25);
            pixels[(y * size + x) * 4 + 3] = Math.round(
                255 * (0.025 + (value - 0.5) * 0.04)
            );
        }
    }

    return pixels;
}
