import { describe, expect, it, vi } from 'vitest';
import { EntityStore } from '.';

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

    it('rejects invalid plain data atomically', () => {
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
    });
});
