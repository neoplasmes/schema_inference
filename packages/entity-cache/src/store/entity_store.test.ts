import { describe, expect, it } from 'vitest';
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
});
