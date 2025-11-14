import { Text, TextStyle } from 'pixi.js';
import type { ResolvedBoardTheme } from '../theme';
import { paint, type ColorName } from '../theme';

export type LabelRole =
    | 'body'
    | 'headline'
    | 'mono'
    | 'subheadline'
    | 'count'
    | 'footnote';

/** The measurement cache is instance-owned and has a fixed entry budget. */
export class LabelMetrics {
    private readonly cache = new Map<string, number>();
    private readonly styles = new Map<string, TextStyle>();
    private readonly context = document.createElement('canvas').getContext('2d');

    constructor(readonly theme: ResolvedBoardTheme) {}

    styleFor(role: LabelRole, ink: ColorName, bold: boolean, italic: boolean): TextStyle {
        const key = `${role}:${ink}:${bold}:${italic}`;
        let style = this.styles.get(key);

        if (!style) {
            const token = this.theme.text[role];
            style = new TextStyle({
                fontFamily: this.theme.font[token.family],
                fontSize: Number.parseFloat(token.fontSize),
                lineHeight: Number.parseFloat(token.lineHeight),
                fontWeight: bold ? '600' : (token.fontWeight as '400' | '600'),
                fontStyle: italic ? 'italic' : 'normal',
                fill: paint(ink, this.theme).color,
                letterSpacing: Number.parseFloat(token.letterSpacing),
            });
            this.styles.set(key, style);
        }

        return style;
    }

    width(value: string, role: LabelRole, bold = false, italic = false): number {
        const key = `${role}:${bold}:${italic}:${value}`;
        const cached = this.cache.get(key);

        if (cached !== undefined) {
            return cached;
        }

        const token = this.theme.text[role];
        let width = value.length * Number.parseFloat(token.fontSize) * 0.6;

        if (this.context) {
            this.context.font = `${italic ? 'italic ' : ''}${bold ? 600 : token.fontWeight} ${token.fontSize} ${this.theme.font[token.family]}`;
            width = this.context.measureText(value).width;
        }

        if (this.cache.size >= 2048) {
            this.cache.delete(this.cache.keys().next().value!);
        }

        this.cache.set(key, width);

        return width;
    }

    ellipsis(
        value: string,
        maxWidth: number,
        role: LabelRole,
        bold = false,
        italic = false
    ): string {
        if (this.width(value, role, bold, italic) <= maxWidth) {
            return value;
        }

        if (maxWidth < this.width('…', role, bold, italic)) {
            return '';
        }

        const characters = Array.from(value);
        let low = 0;
        let high = characters.length;

        while (low < high) {
            const middle = Math.ceil((low + high) / 2);

            if (
                this.width(
                    `${characters.slice(0, middle).join('')}…`,
                    role,
                    bold,
                    italic
                ) <= maxWidth
            ) {
                low = middle;
            } else {
                high = middle - 1;
            }
        }

        return `${characters.slice(0, low).join('')}…`;
    }

    clear(): void {
        this.cache.clear();
        this.styles.clear();
    }
}

export type LabelSpec = Readonly<{
    text: string;
    x: number;
    y: number;
    role?: LabelRole;
    ink?: ColorName;
    bold?: boolean;
    italic?: boolean;
    right?: boolean;
    maxWidth?: number;
}>;

export class RetainedLabel {
    readonly view: Text;
    private styleKey = '';

    constructor(
        private readonly metrics: LabelMetrics,
        resolution: number
    ) {
        this.view = new Text({
            text: '',
            resolution,
        });
        this.view.anchor.set(0, 0.5);
    }

    update(spec: LabelSpec): void {
        const role = spec.role ?? 'body';
        const ink = spec.ink ?? 'label';
        const key = `${role}:${ink}:${!!spec.bold}:${!!spec.italic}`;

        if (this.styleKey !== key) {
            this.view.style = this.metrics.styleFor(
                role,
                ink,
                !!spec.bold,
                !!spec.italic
            );
            this.styleKey = key;
        }

        const value =
            spec.maxWidth === undefined
                ? spec.text
                : this.metrics.ellipsis(
                      spec.text,
                      spec.maxWidth,
                      role,
                      spec.bold,
                      spec.italic
                  );

        if (this.view.text !== value) {
            this.view.text = value;
        }

        this.view.alpha = paint(ink, this.metrics.theme).alpha;
        this.view.anchor.x = spec.right ? 1 : 0;
        this.view.position.set(spec.x, spec.y);
    }
}
