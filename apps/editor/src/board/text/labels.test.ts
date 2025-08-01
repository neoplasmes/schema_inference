import { afterEach, expect, it, vi } from 'vitest';

vi.mock('pixi.js', () => ({ Text: class {}, TextStyle: class {} }));

import { LabelMetrics } from './labels';
import { resolveTheme } from '../theme';

afterEach(() => vi.unstubAllGlobals());

it('measures and truncates each font style independently in its bounded cache', () => {
    const context = {
        font: '',
        measureText: vi.fn(() => ({
            width: context.font.startsWith('italic ') ? 20 : 10,
        })),
    };
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => context }) });
    const metrics = new LabelMetrics(resolveTheme());

    expect(metrics.width('sample', 'body')).toBe(10);
    expect(metrics.width('sample', 'body', false, true)).toBe(20);
    expect(context.measureText).toHaveBeenCalledTimes(2);
    expect(metrics.width('sample', 'body')).toBe(10);
    expect(context.measureText).toHaveBeenCalledTimes(2);
    expect(metrics.ellipsis('sample', 15, 'body')).toBe('sample');
    expect(metrics.ellipsis('sample', 15, 'body', false, true)).toBe('');
});
