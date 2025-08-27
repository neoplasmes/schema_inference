import { EntityStore } from '@app/entity-cache/store';
import { describe, expect, it, vi } from 'vitest';
import type { MemberPage, SchemaRepository } from '../../../app/ports/repos/schema';
import { CachedSchemaRepository } from '.';

const snapshot = {
    resource: 'schema',
    id: 'schema',
    revision: 's1',
} as const;

function page(collectionId: string): MemberPage {
    return {
        snapshot,
        collectionId,
        scopeId: null,
        items: [],
        totalItems: 0,
        nextCursor: null,
    };
}

function repository(readMembers: SchemaRepository['readMembers']): SchemaRepository {
    return {
        readMembers,
        open: vi.fn(),
        readNode: vi.fn(),
        createFromAnalysis: vi.fn(),
        save: vi.fn(),
        readChange: vi.fn(),
    };
}

describe('immutable page cache', () => {
    it('deduplicates reads without letting one consumer cancel another', async () => {
        let resolve!: (page: MemberPage) => void;
        let upstreamSignal: AbortSignal | undefined;
        const readMembers = vi.fn<SchemaRepository['readMembers']>(
            (_snapshot, _collection, _cursor, options) => {
                upstreamSignal = options?.signal;

                return new Promise(done => {
                    resolve = done;
                });
            }
        );
        const cache = new CachedSchemaRepository(repository(readMembers));
        const first = new AbortController();
        const second = new AbortController();
        const firstRead = cache.readMembers(snapshot, 'fields', null, {
            signal: first.signal,
        });
        const secondRead = cache.readMembers(snapshot, 'fields', null, {
            signal: second.signal,
        });
        const firstRejection = expect(firstRead).rejects.toMatchObject({
            name: 'AbortError',
        });
        first.abort();
        await firstRejection;
        expect(upstreamSignal?.aborted).toBe(false);
        resolve(page('fields'));
        await expect(secondRead).resolves.toEqual(page('fields'));
        expect(readMembers).toHaveBeenCalledTimes(1);
    });

    it('does not cache a late response after all owners cancelled it', async () => {
        let resolve!: (page: MemberPage) => void;
        const readMembers = vi.fn<SchemaRepository['readMembers']>(
            () =>
                new Promise(done => {
                    resolve = done;
                })
        );
        const cache = new CachedSchemaRepository(repository(readMembers));
        const controller = new AbortController();
        const read = cache.readMembers(snapshot, 'fields', null, {
            signal: controller.signal,
        });
        const rejection = expect(read).rejects.toMatchObject({
            name: 'AbortError',
        });
        controller.abort();
        await rejection;
        resolve(page('fields'));
        await new Promise(done => setTimeout(done, 0));
        expect(cache.cachedPageCount).toBe(0);
    });

    it('bounds the cache and partitions entries by immutable snapshot identity', async () => {
        const readMembers = vi.fn<SchemaRepository['readMembers']>(
            async (_snapshot, collection) => page(collection)
        );
        const cache = new CachedSchemaRepository(repository(readMembers), 2);
        await cache.readMembers(snapshot, 'a', null);
        await cache.readMembers(snapshot, 'b', null);
        await cache.readMembers(snapshot, 'a', null);
        await cache.readMembers(snapshot, 'c', null);
        expect(cache.cachedPageCount).toBe(2);
        await cache.readMembers(snapshot, 'b', null);
        await cache.readMembers(
            {
                ...snapshot,
                revision: 's2',
            },
            'b',
            null
        );
        expect(readMembers).toHaveBeenCalledTimes(5);
    });
});

describe('normalized page contents', () => {
    it('shares entity contents across pages and releases only evicted page ownership', async () => {
        const store = new EntityStore();
        const readMembers = vi.fn<SchemaRepository['readMembers']>(
            async (current, collection) => ({
                ...page(collection),
                snapshot: current,
                items: [
                    {
                        member: {
                            id: 'member',
                            kind: 'property',
                            name: 'name',
                            required: true,
                            valueNodeId: 'node',
                        },
                        valueSummary: {
                            id: 'node',
                            kind: 'scalar',
                            label: current.revision,
                            directMemberCount: 0,
                            descendantCount: 0,
                        },
                    },
                ],
                totalItems: 1,
            })
        );
        const cache = new CachedSchemaRepository(repository(readMembers), 2, store);
        await cache.readMembers(snapshot, 'a', null);
        await cache.readMembers(snapshot, 'b', null);
        expect(store.size).toBe(2);
        const first = await cache.readMembers(snapshot, 'a', null);
        const second = await cache.readMembers(snapshot, 'b', null);
        expect(first.items[0].member).toBe(second.items[0].member);
        await cache.readMembers(
            {
                ...snapshot,
                revision: 's2',
            },
            'c',
            null
        );
        expect(store.size).toBe(4);
        expect(
            (await cache.readMembers(snapshot, 'b', null)).items[0].valueSummary.label
        ).toBe('s1');
        cache.clear();
        expect(store.size).toBe(0);
    });

    it('does not normalize a late cancelled page or clear another cache owners records', async () => {
        const store = new EntityStore();
        store.upsert('external:1', {
            title: 'Retained elsewhere',
        });
        const release = store.retain([
            'external:1',
        ]);
        let resolve!: (value: MemberPage) => void;
        const cache = new CachedSchemaRepository(
            repository(
                () =>
                    new Promise(done => {
                        resolve = done;
                    })
            ),
            2,
            store
        );
        const pending = cache.readMembers(snapshot, 'a', null);
        const rejection = expect(pending).rejects.toMatchObject({
            name: 'AbortError',
        });
        cache.clear();
        await rejection;
        resolve({
            ...page('a'),
            items: [
                {
                    member: {
                        id: 'late',
                        kind: 'property',
                        name: 'late',
                        required: true,
                        valueNodeId: 'node',
                    },
                    valueSummary: {
                        id: 'node',
                        kind: 'scalar',
                        label: 'late',
                        directMemberCount: 0,
                        descendantCount: 0,
                    },
                },
            ],
            totalItems: 1,
        });
        await new Promise(done => setTimeout(done, 0));
        expect(store.size).toBe(1);
        expect(store.get('external:1')).toMatchObject({
            title: 'Retained elsewhere',
        });
        expect(cache.cachedPageCount).toBe(0);
        release();
        store.sweep();
        expect(store.size).toBe(0);
    });
});
