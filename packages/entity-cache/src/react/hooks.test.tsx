import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CacheProvider } from './CacheProvider';
import { createCacheRuntime } from './cacheRuntime';
import { useRead } from './useRead';
import { useCommand } from './useCommand';

let container: HTMLDivElement;
let root: Root;
let runtime: ReturnType<typeof createCacheRuntime>;

beforeEach(() => {
    (
        globalThis as {
            IS_REACT_ACT_ENVIRONMENT?: boolean;
        }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    runtime = createCacheRuntime();
});

afterEach(async () => {
    await act(async () => root.unmount());
    runtime.invalidator.clearAll();
    container.remove();
});

async function settle(): Promise<void> {
    await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
    });
}

describe('React cache adapter', () => {
    it('stops polling when the refetch interval function returns false', async () => {
        let calls = 0;
        const query = {
            name: 'job',
            reads: () => [
                'job:1',
            ],
            execute: async () => {
                calls += 1;

                return {
                    ref: 'job:1',
                    status: calls < 3 ? 'processing' : 'failed',
                };
            },
        };

        function View() {
            useRead(query, undefined, {
                refetchInterval: job => (job?.status === 'failed' ? false : 5),
            });

            return null;
        }

        await act(async () =>
            root.render(
                <CacheProvider runtime={runtime}>
                    <View />
                </CacheProvider>
            )
        );
        await settle();
        await settle();
        await settle();

        expect(calls).toBe(3);
    });

    it('subscribes to nested entities while preserving an unrelated read snapshot', async () => {
        const query = {
            name: 'order',
            reads: () => [
                'order:1',
            ],
            execute: async () => ({
                ref: 'order:1',
                customer: {
                    ref: 'user:1',
                    name: 'Ada',
                },
            }),
        };
        let renders = 0;

        function View() {
            const { data, isPending } = useRead(query, undefined);
            renders += 1;

            return <span>{isPending ? 'Loading' : data?.customer.name}</span>;
        }

        await act(async () =>
            root.render(
                <CacheProvider runtime={runtime}>
                    <View />
                </CacheProvider>
            )
        );
        await settle();
        expect(container.textContent).toBe('Ada');
        const before = renders;
        await act(async () =>
            runtime.entityStore.upsert('unrelated:1', {
                name: 'Other',
            })
        );
        expect(renders).toBe(before);
        await act(async () =>
            runtime.entityStore.upsert('user:1', {
                name: 'Updated',
            })
        );
        expect(container.textContent).toBe('Updated');
    });

    it('shows a failed command rollback without discarding a confirmed update', async () => {
        const query = {
            name: 'user',
            reads: () => [
                'user:1',
            ],
            execute: async () => ({
                ref: 'user:1',
                name: 'Base',
                visits: 1,
            }),
        };
        let reject!: (error: Error) => void;
        const command = {
            execute: () =>
                new Promise<{
                    ref: string;
                    name: string;
                }>((_done, fail) => {
                    reject = fail;
                }),
            writes: () => [
                'user:1',
            ],
        };
        let execute!: (input: undefined) => Promise<{
            ref: string;
            name: string;
        }>;

        function View() {
            const { data } = useRead(query, undefined);
            const mutation = useCommand(command, {
                optimistic: () => [
                    {
                        ref: 'user:1',
                        patch: {
                            name: 'Optimistic',
                        },
                    },
                ],
            });
            execute = mutation.execute;

            return (
                <span>
                    {data?.name}/{data?.visits}/{mutation.error?.message}
                </span>
            );
        }

        await act(async () =>
            root.render(
                <CacheProvider runtime={runtime}>
                    <View />
                </CacheProvider>
            )
        );
        await settle();
        let pending!: Promise<unknown>;
        await act(async () => {
            pending = execute(undefined).catch(error => error);
            await Promise.resolve();
        });
        await settle();
        expect(container.textContent).toContain('Optimistic/1');
        await act(async () => {
            runtime.entityStore.upsert('user:1', {
                name: 'Concurrent',
                visits: 2,
            });
            reject(new Error('Write rejected'));
            await pending;
        });
        await settle();
        expect(container.textContent).toBe('Concurrent/2/Write rejected');
    });
});
