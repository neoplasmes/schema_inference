import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryObserver } from '@tanstack/react-query';
import { createCacheRuntime } from './cacheRuntime';

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
        cache.invalidator.evict([
            'user',
        ]);
        expect(cache.entityStore.size).toBe(1);
        cache.invalidator.evict([
            'user:1',
        ]);
        expect(cache.entityStore.size).toBe(0);
    });

    it('retains both results when concurrent reads normalize before their cache success events', async () => {
        const cache = runtime();
        const first = deferred<{
            ref: string;
            child: {
                ref: string;
                name: string;
            };
        }>();
        const second = deferred<{
            ref: string;
            name: string;
        }>();
        const firstRead = cache.queryClient.fetchQuery(
            cache.queryOptionsFor(
                {
                    name: 'first',
                    reads: () => [
                        'first',
                    ],
                    execute: () => first.promise,
                },
                undefined
            )
        );
        const secondRead = cache.queryClient.fetchQuery(
            cache.queryOptionsFor(
                {
                    name: 'second',
                    reads: () => [
                        'second',
                    ],
                    execute: () => second.promise,
                },
                undefined
            )
        );
        first.resolve({
            ref: 'first:1',
            child: {
                ref: 'child:1',
                name: 'Nested',
            },
        });
        second.resolve({
            ref: 'second:1',
            name: 'Other',
        });
        const [one, two] = await Promise.all([
            firstRead,
            secondRead,
        ]);
        expect(cache.selector(one)()).toEqual({
            ref: 'first:1',
            child: {
                ref: 'child:1',
                name: 'Nested',
            },
        });
        expect(cache.selector(two)()).toEqual({
            ref: 'second:1',
            name: 'Other',
        });
        expect(cache.entityStore.size).toBe(3);
        cache.invalidator.evict([
            'first',
        ]);
        expect(cache.entityStore.size).toBe(1);
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

    it('invalidates only declared reads and refetches their composition', async () => {
        const cache = runtime();
        const readUsers = vi.fn(async () => [
            {
                ref: 'user:1',
                name: 'Ada',
            },
        ]);
        const readOrders = vi.fn(async () => [
            {
                ref: 'order:1',
                total: 2,
            },
        ]);
        const users = new QueryObserver(
            cache.queryClient,
            cache.queryOptionsFor(
                {
                    name: 'users',
                    reads: () => [
                        'user',
                    ],
                    execute: readUsers,
                },
                undefined
            )
        );
        const orders = new QueryObserver(
            cache.queryClient,
            cache.queryOptionsFor(
                {
                    name: 'orders',
                    reads: () => [
                        'order',
                    ],
                    execute: readOrders,
                },
                undefined
            )
        );
        const unsubscribeUsers = users.subscribe(() => undefined);
        const unsubscribeOrders = orders.subscribe(() => undefined);
        await Promise.all([
            users.refetch(),
            orders.refetch(),
        ]);
        await cache.execute(
            {
                execute: async () => ({
                    ref: 'user:2',
                    name: 'Grace',
                }),
                writes: () => [
                    'user',
                ],
            },
            undefined
        );
        expect(readUsers).toHaveBeenCalledTimes(2);
        expect(readOrders).toHaveBeenCalledTimes(1);
        expect(cache.entityStore.get('user:2')).toBeUndefined();
        unsubscribeUsers();
        unsubscribeOrders();
    });

    it('serializes overlapping writes and preserves a concurrent base update on failure', async () => {
        const cache = runtime();
        cache.entityStore.upsert('user:1', {
            name: 'Base',
            visits: 1,
        });
        const release = cache.entityStore.retain([
            'user:1',
        ]);
        const firstResult = deferred<{
            ref: string;
            name: string;
        }>();
        const firstCall = vi.fn(() => firstResult.promise);
        const secondCall = vi.fn(async () => ({
            ref: 'user:1',
            name: 'Second saved',
        }));
        const first = cache.execute(
            {
                execute: firstCall,
                writes: () => [
                    'user:1',
                ],
            },
            undefined,
            {
                optimistic: () => [
                    {
                        ref: 'user:1',
                        patch: {
                            name: 'First optimistic',
                        },
                    },
                ],
            }
        );
        const rejected = expect(first).rejects.toThrow('Rejected');
        const second = cache.execute(
            {
                execute: secondCall,
                writes: () => [
                    'user:1',
                ],
            },
            undefined,
            {
                optimistic: () => [
                    {
                        ref: 'user:1',
                        patch: {
                            name: 'Second optimistic',
                        },
                    },
                ],
            }
        );
        await Promise.resolve();
        expect(secondCall).not.toHaveBeenCalled();
        cache.entityStore.upsert('user:1', {
            name: 'Concurrent base',
            visits: 2,
        });
        firstResult.reject(new Error('Rejected'));
        await rejected;
        await second;
        expect(cache.entityStore.get('user:1')).toEqual({
            ref: 'user:1',
            name: 'Second saved',
            visits: 2,
        });
        release();
    });

    it('rejects old write completion after clear without disturbing a new session', async () => {
        const cache = runtime();
        const response = deferred<{
            ref: string;
            name: string;
        }>();
        const write = cache.execute(
            {
                execute: () => response.promise,
                writes: () => [
                    'user',
                ],
            },
            undefined,
            {
                optimistic: () => [
                    {
                        ref: 'user:1',
                        patch: {
                            name: 'Old optimistic',
                        },
                    },
                ],
            }
        );
        const rejected = expect(write).rejects.toMatchObject({
            name: 'AbortError',
        });
        await Promise.resolve();
        cache.invalidator.clearAll();
        cache.entityStore.upsert('user:1', {
            name: 'New session',
        });
        const release = cache.entityStore.retain([
            'user:1',
        ]);
        response.resolve({
            ref: 'user:1',
            name: 'Old saved',
        });
        await rejected;
        expect(cache.entityStore.get('user:1')).toEqual({
            ref: 'user:1',
            name: 'New session',
        });
        release();
    });
});

describe('read and write ordering', () => {
    it('repeats a pending collection read when an entity write completed after it began', async () => {
        const cache = runtime();
        const stale =
            deferred<
                {
                    ref: string;
                    title: string;
                }[]
            >();
        const execute = vi
            .fn()
            .mockImplementationOnce(() => stale.promise)
            .mockResolvedValue([
                {
                    ref: 'schema:1',
                    title: 'Saved',
                },
            ]);
        const read = cache.queryClient.fetchQuery(
            cache.queryOptionsFor(
                {
                    name: 'schemas',
                    reads: () => [
                        'schema',
                    ],
                    execute: execute as () => Promise<
                        {
                            ref: string;
                            title: string;
                        }[]
                    >,
                },
                undefined
            )
        );
        await cache.execute(
            {
                execute: async () => ({
                    ref: 'schema:1',
                    title: 'Saved',
                }),
                writes: () => [
                    'schema:1',
                ],
            },
            undefined
        );
        stale.resolve([
            {
                ref: 'schema:1',
                title: 'Stale',
            },
        ]);
        const result = await read;
        expect(execute).toHaveBeenCalledTimes(2);
        expect(cache.selector(result)()).toEqual([
            {
                ref: 'schema:1',
                title: 'Saved',
            },
        ]);
    });
});
