import { afterEach, describe, expect, it } from 'vitest';
import { createCacheRuntime } from './cache_runtime';

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<T>((done, fail) => {
        resolve = done;
        reject = fail;
    });

    return {
        promise,
        resolve,
        reject,
    };
}

const runtimes: ReturnType<typeof createCacheRuntime>[] = [];

function runtime() {
    const value = createCacheRuntime();
    runtimes.push(value);

    return value;
}

afterEach(() => {
    runtimes.forEach(value => value.invalidator.clearAll());
    runtimes.length = 0;
});

describe('cache runtime', () => {
    it('stores compositions in query cache and merges list/detail data into one record', async () => {
        const cache = runtime();
        const list = {
            name: 'users',
            reads: () => [
                'user',
            ],
            execute: async () => [
                {
                    ref: 'user:1',
                    name: 'Ada',
                },
            ],
        };
        const detail = {
            name: 'user',
            reads: () => [
                'user:1',
            ],
            execute: async () => ({
                ref: 'user:1',
                email: 'ada@example.test',
            }),
        };
        const composition = await cache.queryClient.fetchQuery(
            cache.queryOptionsFor(list, undefined)
        );
        const select =
            cache.selector<
                {
                    ref: string;
                    name: string;
                    email?: string;
                }[]
            >(composition);
        const before = select();
        await cache.queryClient.fetchQuery(cache.queryOptionsFor(detail, undefined));
        expect(select()).toEqual([
            {
                ref: 'user:1',
                name: 'Ada',
                email: 'ada@example.test',
            },
        ]);
        expect(select()).not.toBe(before);
        expect(select()).toBe(select());
        expect(
            JSON.stringify(
                cache.queryClient.getQueryData([
                    'users',
                    undefined,
                ])
            )
        ).not.toContain('Ada');
    });

    it('does not normalize a late response after cancellation even when the repository ignores its signal', async () => {
        const cache = runtime();
        const response = deferred<{
            ref: string;
            name: string;
        }>();
        const request = cache.queryClient.fetchQuery(
            cache.queryOptionsFor(
                {
                    name: 'late',
                    reads: () => [
                        'user',
                    ],
                    execute: () => response.promise,
                },
                undefined
            )
        );
        const rejected = expect(request).rejects.toBeDefined();
        await cache.queryClient.cancelQueries();
        await rejected;
        response.resolve({
            ref: 'user:1',
            name: 'Stale',
        });
        await response.promise;
        await Promise.resolve();
        expect(cache.entityStore.size).toBe(0);
    });

    it('clears the epoch so an earlier read cannot repopulate a new session', async () => {
        const cache = runtime();
        const response = deferred<{
            ref: string;
            name: string;
        }>();
        const request = cache.queryClient.fetchQuery(
            cache.queryOptionsFor(
                {
                    name: 'user',
                    reads: () => [
                        'user',
                    ],
                    execute: () => response.promise,
                },
                undefined
            )
        );
        const rejected = expect(request).rejects.toBeDefined();
        cache.invalidator.clearAll();
        const current = await cache.queryClient.fetchQuery(
            cache.queryOptionsFor(
                {
                    name: 'user',
                    reads: () => [
                        'user',
                    ],
                    execute: async () => ({
                        ref: 'user:1',
                        name: 'Current',
                    }),
                },
                undefined
            )
        );
        response.resolve({
            ref: 'user:1',
            name: 'Old',
        });
        await rejected;
        await Promise.resolve();
        expect(cache.selector(current)()).toEqual({
            ref: 'user:1',
            name: 'Current',
        });
    });
});
