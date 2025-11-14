import { expect, it, vi } from 'vitest';
import type { Texture } from 'pixi.js';
import type { BoardRow } from '../../model';
import type { LabelMetrics } from '../../text';
import { resolveTheme } from '../../theme';
import { paint } from '../../theme';

const state = vi.hoisted(() => ({
    labels: [] as {
        update: ReturnType<typeof vi.fn>;
    }[],
    fill: vi.fn(),
    shadow: vi.fn(),
}));

vi.mock('pixi.js', () => ({
    Container: class {
        visible = true;
        eventMode = 'auto';
        position = {
            set: vi.fn(),
        };
        children: unknown[] = [];
        addChild(...children: unknown[]) {
            this.children.push(...children);
        }
    },
    Graphics: class {
        clear() {
            return this;
        }
        roundRect() {
            return this;
        }
        circle() {
            return this;
        }
        fill(value: unknown) {
            state.fill(value);
            return this;
        }
    },
    NineSliceSprite: class {
        position = {
            set: vi.fn(),
        };
        width = 0;
        height = 0;
        constructor(options: unknown) {
            state.shadow(options);
        }
    },
}));

vi.mock('../../text', () => ({
    RetainedLabel: class {
        view = {
            resolution: 1,
        };
        update = vi.fn();
        constructor() {
            state.labels.push(this);
        }
    },
}));

import { DragGhostView } from './drag_ghost_view';

it('retains one shadowed white row preview with real source metadata and dimensions across moves', () => {
    const theme = resolveTheme();
    const metrics = {
        theme,
        width: (text: string) => text.length * 7,
    } as unknown as LabelMetrics;
    const shadow = {} as Texture;
    const ghost = new DragGhostView(metrics, shadow, 2);
    const row: BoardRow = {
        memberId: 'weight-id',
        name: 'weight',
        typeLabel: 'decimal',
        icon: 'scalar',
        change: 'unchanged',
        expandable: false,
        expanded: false,
    };
    const source = {
        x: 100,
        y: 200,
        width: 362,
        height: 34,
    };
    ghost.update(
        row,
        source,
        {
            x: 400,
            y: 300,
        },
        2
    );
    expect(ghost.root.position.set).toHaveBeenLastCalledWith(290, 283);
    expect(state.labels[0].update).toHaveBeenLastCalledWith(
        expect.objectContaining({
            text: 'weight',
            bold: true,
        })
    );
    expect(state.labels[1].update).toHaveBeenLastCalledWith(
        expect.objectContaining({
            text: 'decimal',
            right: true,
        })
    );
    expect(state.shadow).toHaveBeenCalledWith(
        expect.objectContaining({
            texture: shadow,
        })
    );
    expect(state.fill).toHaveBeenCalledWith(paint('surface-card', theme));
    ghost.root.visible = false;
    ghost.update(
        {
            ...row,
            memberId: 'title-id',
            name: 'title',
            typeLabel: 'string',
        },
        {
            ...source,
            width: 160,
        },
        {
            x: 440,
            y: 320,
        },
        1
    );
    expect(ghost.root.visible).toBe(true);
    expect(ghost.root.position.set).toHaveBeenLastCalledWith(360, 303);
    expect(state.labels).toHaveLength(2);
    expect(state.labels[0].update).toHaveBeenLastCalledWith(
        expect.objectContaining({
            text: 'title',
        })
    );
    expect(state.labels[1].update).toHaveBeenLastCalledWith(
        expect.objectContaining({
            text: 'string',
        })
    );
});
