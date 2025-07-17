import { tokens } from '../theme/tokens';

type TextToken = {
    fontSize: string;
    lineHeight: string;
    fontWeight: string;
    letterSpacing: string;
    family: keyof typeof tokens.font;
};

export type BoardTheme = {
    color?: Partial<Record<keyof typeof tokens.color, string>>;
    font?: Partial<Record<keyof typeof tokens.font, string>>;
    radius?: Partial<Record<keyof typeof tokens.radius, string | number>>;
    shadow?: Partial<Record<keyof typeof tokens.shadow, string>>;
    text?: Partial<Record<keyof typeof tokens.text, Partial<TextToken>>>;
};

export type ResolvedBoardTheme = {
    color: Record<keyof typeof tokens.color, string>;
    font: Record<keyof typeof tokens.font, string>;
    radius: Record<keyof typeof tokens.radius, string | number>;
    shadow: Record<keyof typeof tokens.shadow, string>;
    text: Record<keyof typeof tokens.text, TextToken>;
};

export function resolveTheme(theme: BoardTheme = {}): ResolvedBoardTheme {
    const text = { ...tokens.text } as ResolvedBoardTheme['text'];

    for (const key of Object.keys(text) as (keyof typeof text)[]) {
        text[key] = { ...text[key], ...theme.text?.[key] };
    }

    return {
        color: { ...tokens.color, ...theme.color },
        font: { ...tokens.font, ...theme.font },
        radius: { ...tokens.radius, ...theme.radius },
        shadow: { ...tokens.shadow, ...theme.shadow },
        text,
    };
}

export function themeRadius(
    theme: ResolvedBoardTheme,
    name: keyof typeof tokens.radius
): number {
    return Number.parseFloat(String(theme.radius[name]));
}
