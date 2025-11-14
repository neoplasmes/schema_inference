import { describe, expect, it } from 'vitest';
import { tokens } from './tokens';
import { paint } from './colors';
import { resolveTheme, themeRadius } from './board_theme';

describe('instance theme', () => {
    it('merges partial categories without mutating generated defaults or another board', () => {
        const custom = resolveTheme({
            color: {
                accent: tokens.color.danger,
            },
            font: {
                sans: 'Arial',
            },
            radius: {
                'radius-md': 16,
            },
            text: {
                body: {
                    fontWeight: '600',
                },
            },
        });
        const standard = resolveTheme();

        expect(custom.color.accent).toBe(tokens.color.danger);
        expect(standard.color.accent).toBe(tokens.color.accent);
        expect(custom.color['surface-card']).toBe(tokens.color['surface-card']);
        expect(custom.text.body.fontWeight).toBe('600');
        expect(custom.text.body.fontSize).toBe(tokens.text.body.fontSize);
        expect(standard.text.body.fontWeight).toBe('400');
        expect(themeRadius(custom, 'radius-md')).toBe(16);
        expect(paint('accent', custom)).toEqual(paint('danger', standard));
    });
});
