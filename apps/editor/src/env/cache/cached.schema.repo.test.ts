import { describe, expect, it, vi } from 'vitest';
import type {
    MemberPage,
    SchemaRepository,
} from '../../application/ports/repos/schema.repo';
import { CachedSchemaRepository } from './cached.schema.repo';

const snapshot = { resource: 'schema', id: 'schema', revision: 's1' } as const;

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
        const rejection = expect(read).rejects.toMatchObject({ name: 'AbortError' });
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
        await cache.readMembers({ ...snapshot, revision: 's2' }, 'b', null);
        expect(readMembers).toHaveBeenCalledTimes(5);
    });
});
