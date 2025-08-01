import { beforeEach, expect, it, vi } from 'vitest';
import type { LabelMetrics } from '../../text';

const state = vi.hoisted(() => ({
    update: vi.fn(),
    remove: vi.fn(),
    destroy: vi.fn(),
    constructed: vi.fn(),
}));

vi.mock('../../text', () => ({
    RetainedLabel: class {
        view = { visible: true, removeFromParent: state.remove, destroy: state.destroy };
        update = state.update;
        constructor() {
            state.constructed();
        }
    },
}));

import { BoardStatusView } from './status_view';

beforeEach(() => vi.clearAllMocks());

function setup() {
    const metrics = { width: () => 180 } as unknown as LabelMetrics;

    return new BoardStatusView(metrics, 2);
}

it('retains one screen-space label across loading, empty and failure updates and recenters on resize', () => {
    const status = setup();
    status.update('loading', 0, 800, 600);
    expect(status.view.visible).toBe(true);
    expect(state.update).toHaveBeenLastCalledWith(
        expect.objectContaining({ text: 'Loading schema...', x: 310, y: 300 })
    );
    status.update('empty', 0, 1000, 800);
    expect(state.update).toHaveBeenLastCalledWith(
        expect.objectContaining({ text: 'No schema fields are loaded', x: 410, y: 400 })
    );
    status.update('failed', 0, 1000, 800);
    expect(state.update).toHaveBeenLastCalledWith(
        expect.objectContaining({ text: 'Schema could not load', ink: 'danger' })
    );
    expect(state.constructed).toHaveBeenCalledTimes(1);
    status.update('loading', 1, 1000, 800);
    expect(status.view.visible).toBe(false);
    status.update('ready', 0, 1000, 800);
    expect(status.view.visible).toBe(false);
    status.destroy();
});

it('releases the retained label once and rejects updates after disposal', () => {
    const status = setup();
    status.destroy();
    status.destroy();
    status.update('loading', 0, 800, 600);
    expect(state.remove).toHaveBeenCalledTimes(1);
    expect(state.destroy).toHaveBeenCalledTimes(1);
    expect(state.update).not.toHaveBeenCalled();
});
