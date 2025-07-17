import { describe, expect, it } from 'vitest';
import { tokens } from './tokens';

describe('generated design tokens', () => {
    it('uses neutral surfaces and black opacity for greys', () => {
        const accentNames = new Set([
            'canvas-tint',
            'accent',
            'accent-fill',
            'accent-ink',
            'accent-ink-hover',
            'danger',
        ]);
        const surfaceNames = new Set(['surface-canvas', 'canvas-shade', 'glass-scrim']);

        for (const [name, value] of Object.entries(tokens.color)) {
            if (accentNames.has(name)) {
                continue;
            }

            const red = Number.parseInt(value.slice(1, 3), 16);
            const green = Number.parseInt(value.slice(3, 5), 16);
            const blue = Number.parseInt(value.slice(5, 7), 16);

            expect(red, name).toBe(green);
            expect(green, name).toBe(blue);

            if (surfaceNames.has(name)) {
                continue;
            }

            expect(red === 0 || red === 255, name).toBe(true);
        }
    });

    it('keeps chromatic colors olive except for the error text token', () => {
        for (const [name, value] of Object.entries(tokens.color)) {
            const red = Number.parseInt(value.slice(1, 3), 16);
            const green = Number.parseInt(value.slice(3, 5), 16);
            const blue = Number.parseInt(value.slice(5, 7), 16);

            if (red === green && green === blue) {
                continue;
            }

            if (name === 'danger') {
                expect(red).toBeGreaterThan(green);
                expect(red).toBeGreaterThan(blue);

                continue;
            }

            expect(green, name).toBeGreaterThan(red);
            expect(red, name).toBeGreaterThan(blue);
        }
    });
});
