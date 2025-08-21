import { QueryClient, hashKey, queryOptions } from '@tanstack/react-query';
import type { Query as CachedQuery } from '@tanstack/react-query';
import { EntityStore, references } from '../store';
import type { NormalizedValue } from '../store';
import type { Query } from './contracts';

type CachedRead = Readonly<{
    kind: 'entity-cache-result';
    value: NormalizedValue;
    epoch: number;
    requestId: number;
}>;

type RetainedRead = Readonly<{
    value: CachedRead;
    release(): void;
}>;

function cancelled(): Error {
    const error = new Error('The cache operation was cancelled.');
    error.name = 'AbortError';

    return error;
}

function isCachedRead(value: unknown): value is CachedRead {
    return (
        typeof value === 'object' &&
        value !== null &&
        'kind' in value &&
        value.kind === 'entity-cache-result'
    );
}

/** Owns normalized reads and their retained entity roots. */
export class CacheRuntime {
    readonly entityStore = new EntityStore();
    readonly queryClient: QueryClient;
    private epoch = 0;
    private requestSequence = 0;
    private readonly pendingReads = new Map<
        string,
        {
            id: number;
            release(): void;
        }
    >();
    private readonly retained = new Map<string, RetainedRead>();

    constructor(
        options: {
            staleTime?: number;
            gcTime?: number;
        } = {}
    ) {
        this.queryClient = new QueryClient({
            defaultOptions: {
                queries: {
                    staleTime: options.staleTime ?? 30_000,
                    gcTime: options.gcTime ?? 300_000,
                    retry: false,
                },
                mutations: {
                    retry: false,
                },
            },
        });
        this.queryClient.getQueryCache().subscribe(event => {
            const key = event.query.queryHash;
            const retained = this.retained.get(key);
            const value = event.query.state.data;

            if (event.type === 'removed') {
                retained?.release();
                this.retained.delete(key);
                this.releasePending(key);
                this.entityStore.sweep();

                return;
            }

            if (
                isCachedRead(value) &&
                value.epoch === this.epoch &&
                retained?.value !== value
            ) {
                const release = this.entityStore.retain(references(value.value));
                retained?.release();
                this.retained.set(key, {
                    value,
                    release,
                });

                if (this.pendingReads.get(key)?.id === value.requestId) {
                    this.releasePending(key);
                }

                this.entityStore.sweep();
            }

            if (event.type === 'updated' && event.query.state.fetchStatus === 'idle') {
                this.releasePending(key);
                this.entityStore.sweep();
            }
        });
    }

    readonly invalidator = {
        invalidate: async (refs: readonly string[]): Promise<void> => {
            await this.queryClient.invalidateQueries({
                predicate: query => this.intersects(query, refs),
            });
        },
        evict: (refs: readonly string[]): void => {
            this.queryClient.removeQueries({
                predicate: query => this.intersects(query, refs),
            });
        },
        invalidateAll: async (): Promise<void> => {
            await this.queryClient.invalidateQueries();
        },
        clearAll: (): void => {
            this.epoch += 1;
            void this.queryClient.cancelQueries();
            this.queryClient.clear();
            this.retained.forEach(read => read.release());
            this.retained.clear();
            this.pendingReads.forEach(read => read.release());
            this.pendingReads.clear();
            this.entityStore.clear();
        },
    };

    queryOptionsFor<I, O>(query: Query<I, O>, input: I) {
        const key = [
            query.name,
            input,
        ] as const;

        return queryOptions({
            queryKey: key,
            meta: {
                tags: [
                    ...query.reads(input),
                ],
            },
            queryFn: async ({ signal }): Promise<CachedRead> => {
                const epoch = this.epoch;

                const value = await query.execute(input, {
                    signal,
                });

                if (signal.aborted || epoch !== this.epoch) {
                    throw cancelled();
                }

                const normalized = this.entityStore.normalize(value);
                const requestId = ++this.requestSequence;
                const release = this.entityStore.retain(references(normalized));
                const hash = hashKey(key);
                this.releasePending(hash);
                this.pendingReads.set(hash, {
                    id: requestId,
                    release,
                });

                return {
                    kind: 'entity-cache-result',
                    value: normalized,
                    epoch,
                    requestId,
                };
            },
        });
    }

    selector<O>(value: unknown): () => O | undefined {
        const read = isCachedRead(value) ? value : undefined;
        const refs = read ? references(read.value) : [];
        let initialized = false;
        let previous: readonly unknown[] = [];
        let result: O | undefined;

        return () => {
            if (!read || read.epoch !== this.epoch) {
                return undefined;
            }

            const current = refs.map(ref => this.entityStore.get(ref));

            if (
                !initialized ||
                current.some((entity, index) => entity !== previous[index])
            ) {
                initialized = true;
                previous = current;
                result = this.entityStore.denormalize<O>(read.value);
            }

            return result;
        };
    }

    private releasePending(key: string): void {
        this.pendingReads.get(key)?.release();
        this.pendingReads.delete(key);
    }

    private intersects(query: CachedQuery, refs: readonly string[]): boolean {
        const tags = query.meta?.tags;

        return (
            Array.isArray(tags) &&
            tags.some(tag => typeof tag === 'string' && refs.includes(tag))
        );
    }
}

export function createCacheRuntime(
    options?: ConstructorParameters<typeof CacheRuntime>[0]
): CacheRuntime {
    return new CacheRuntime(options);
}
