import { describe, expect, it, vi } from 'vitest';
import { createBoardEvents } from './events';
import { diffBoardModels } from './diff';
import type { BoardModel } from './types';

describe('board model update ownership', () => {
    it('detects selection updates without rebuilding cards or connections', () => {
        const previous: BoardModel = {
            version: 1,
            cards: [],
            connections: [],
            selection: null,
            state: 'ready',
        };
        const next = {
            ...previous,
            version: 2,
            selection: {
                blockId: 'a',
                memberId: 'member',
            },
        };

        expect(diffBoardModels(previous, next)).toEqual({
            addedCards: [],
            removedCards: [],
            changedCards: [],
            changedConnections: [],
            removedConnections: [],
            selectionChanged: true,
        });
    });

    it('keeps typed subscriptions independent and makes unsubscribe safe to repeat', () => {
        const first = createBoardEvents();
        const second = createBoardEvents();
        const handler = vi.fn();
        const unsubscribe = first.on('rename', handler);
        first.emit('rename', {
            blockId: 'a',
            memberId: 'one',
            name: 'Поле',
        });
        second.emit('rename', {
            blockId: 'b',
            memberId: 'one',
            name: 'other',
        });
        unsubscribe();
        unsubscribe();
        first.emit('rename', {
            blockId: 'a',
            memberId: 'one',
            name: 'later',
        });

        expect(handler).toHaveBeenCalledExactlyOnceWith({
            blockId: 'a',
            memberId: 'one',
            name: 'Поле',
        });
    });
});
