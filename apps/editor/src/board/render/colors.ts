import { tokens } from '../theme/tokens';
import type { ResolvedBoardTheme } from './theme';

export type ColorName = keyof typeof tokens.color;

export function paint(
    name: ColorName,
    theme: Pick<ResolvedBoardTheme, 'color'> = tokens
): { color: number; alpha: number } {
    const hex = theme.color[name].slice(1);

    return {
        color: Number.parseInt(hex.slice(0, 6), 16),
        alpha: hex.length === 8 ? Number.parseInt(hex.slice(6), 16) / 255 : 1,
    };
}

export function cssAlpha(
    name: ColorName,
    alpha: number,
    theme: Pick<ResolvedBoardTheme, 'color'> = tokens
): string {
    const { color } = paint(name, theme);

    return `rgba(${color >> 16},${(color >> 8) & 255},${color & 255},${alpha})`;
}
