import { describe, expect, it, vi } from 'vitest';
import { EntityStore, references } from '.';

describe('normalized entity store', () => {
    it('merges partial entities, preserves undefined and replaces value objects', () => {
        const store = new EntityStore();
        store.upsert('user:1', {
            name: 'Ada',
            email: 'ada@example.test',
            address: {
                city: 'Paris',
                street: 'Old street',
            },
        });
        store.upsert('user:1', {
            name: undefined,
            email: null,
            address: {
                city: 'Rome',
            },
        });
        expect(store.get('user:1')).toEqual({
            ref: 'user:1',
            name: 'Ada',
            email: null,
            address: {
                city: 'Rome',
            },
        });
    });

    it('normalizes nested entities and refreshes parents without changing unrelated identities', () => {
        const store = new EntityStore();
        const composition = store.normalize({
            results: [
                {
                    ref: 'order:1',
                    customer: {
                        ref: 'user:1',
                        name: 'Ada',
                    },
                },
            ],
            count: 1,
        });
        store.upsert('user:2', {
            name: 'Grace',
        });
        const untouched = store.get('user:2');
        const order = store.get('order:1');
        const listener = vi.fn();
        store.subscribe('order:1', listener);
        store.upsert('user:1', {
            name: 'Updated',
        });
        expect(store.get('order:1')).not.toBe(order);
        expect(store.get('user:2')).toBe(untouched);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(store.denormalize(composition)).toEqual({
            results: [
                {
                    ref: 'order:1',
                    customer: {
                        ref: 'user:1',
                        name: 'Updated',
                    },
                },
            ],
            count: 1,
        });
        store.upsert('user:1', {
            name: 'Updated',
        });
        expect(listener).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(composition)).not.toContain('Updated');
        expect(JSON.stringify(composition)).not.toContain('Ada');
    });

    it('preserves concurrent confirmed updates when optimistic layers fail', () => {
        const store = new EntityStore();
        store.upsert('user:1', {
            name: 'Base',
            visits: 1,
        });
        const first = store.begin();
        first.apply([
            {
                ref: 'user:1',
                patch: {
                    name: 'First',
                },
            },
        ]);
        const second = store.begin();
        second.apply([
            {
                ref: 'user:1',
                patch: {
                    name: 'Second',
                },
            },
        ]);
        store.upsert('user:1', {
            name: 'Realtime',
            visits: 2,
        });
        first.discard();
        expect(store.get('user:1')).toMatchObject({
            name: 'Second',
            visits: 2,
        });
        second.discard();
        expect(store.get('user:1')).toMatchObject({
            name: 'Realtime',
            visits: 2,
        });
    });

    it('restores confirmed entities after an optimistic deletion', () => {
        const store = new EntityStore();
        store.upsert('user:1', {
            name: 'Base',
        });
        const layer = store.begin();
        layer.apply([
            {
                ref: 'user:1',
                remove: true,
            },
        ]);
        expect(store.get('user:1')).toBeUndefined();
        store.upsert('user:1', {
            name: 'New base',
        });
        layer.discard();
        expect(store.get('user:1')).toMatchObject({
            name: 'New base',
        });
    });

    it('retains nested base links during optimistic replacement and sweeps released roots', () => {
        const store = new EntityStore();
        const root = store.normalize({
            ref: 'order:1',
            user: {
                ref: 'user:1',
                name: 'Ada',
            },
        });
        store.upsert('orphan:1', {
            name: 'Unused',
        });
        const release = store.retain(references(root));
        const layer = store.begin();
        layer.apply([
            {
                ref: 'order:1',
                patch: {
                    user: {
                        ref: 'user:2',
                        name: 'Grace',
                    },
                },
            },
        ]);
        store.sweep();
        expect(store.size).toBe(3);
        expect(store.get('user:1')).toBeDefined();
        layer.discard();
        expect(store.get('order:1')).toMatchObject({
            user: {
                name: 'Ada',
            },
        });
        store.sweep();
        expect(store.size).toBe(2);
        release();
        store.sweep();
        expect(store.size).toBe(0);
    });

    it('keeps an entity alive until every read owner releases it', () => {
        const store = new EntityStore();
        store.upsert('user:1', {
            name: 'Ada',
        });
        const first = store.retain([
            'user:1',
        ]);
        const second = store.retain([
            'user:1',
        ]);
        first();
        store.sweep();
        expect(store.size).toBe(1);
        second();
        store.sweep();
        expect(store.size).toBe(0);
    });

    it('normalizes cycles between identified entities and updates the entire cycle', () => {
        const store = new EntityStore();
        const first: {
            ref: string;
            other?: object;
        } = {
            ref: 'node:1',
        };
        const second = {
            ref: 'node:2',
            other: first,
        };
        first.other = second;
        store.normalize(first);
        const before = store.get<{
            ref: string;
            other: {
                other: object;
            };
        }>('node:1')!;
        expect(before.other.other).toBe(before);
        store.upsert('node:2', {
            label: 'Changed',
        });
        const after = store.get<{
            ref: string;
            other: {
                other: object;
            };
        }>('node:1')!;
        expect(after).not.toBe(before);
        expect(after.other.other).toBe(after);
    });

    it('rejects invalid plain data atomically and prevents discarded layers returning after clear', () => {
        const store = new EntityStore();
        expect(() =>
            store.normalize([
                {
                    ref: 'user:1',
                },
                new Date(),
            ])
        ).toThrow('plain data');
        expect(store.size).toBe(0);
        const layer = store.begin();
        layer.apply([
            {
                ref: 'user:1',
                patch: {
                    name: 'Optimistic',
                },
            },
        ]);
        store.clear();
        layer.apply([
            {
                ref: 'user:1',
                patch: {
                    name: 'Late',
                },
            },
        ]);
        layer.discard();
        expect(store.size).toBe(0);
    });
});

describe('removed entity references', () => {
    it('omits removed entities from list results and restores them after rollback', () => {
        const store = new EntityStore();
        const value = store.normalize([
            {
                ref: 'user:1',
                name: 'Ada',
            },
            {
                ref: 'user:2',
                name: 'Grace',
            },
        ]);
        const layer = store.begin();
        layer.apply([
            {
                ref: 'user:1',
                remove: true,
            },
        ]);
        expect(store.denormalize(value)).toEqual([
            {
                ref: 'user:2',
                name: 'Grace',
            },
        ]);
        layer.discard();
        expect(store.denormalize(value)).toEqual([
            {
                ref: 'user:1',
                name: 'Ada',
            },
            {
                ref: 'user:2',
                name: 'Grace',
            },
        ]);
    });
});
