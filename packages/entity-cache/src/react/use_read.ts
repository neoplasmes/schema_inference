import { useMemo, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useCacheRuntime } from './cache_provider';
import type { Query, ReadSettings } from './contracts';

export function useRead<I, O>(
    query: Query<I, O>,
    input: I,
    settings: ReadSettings<O> = {}
) {
    const runtime = useCacheRuntime();
    const { refetchInterval, ...rest } = settings;
    const result = useQuery({
        ...runtime.queryOptionsFor(query, input),
        ...rest,
        refetchInterval:
            typeof refetchInterval === 'function'
                ? current => refetchInterval(runtime.selector<O>(current.state.data)())
                : refetchInterval,
    });
    const getSnapshot = useMemo(
        () => runtime.selector<O>(result.data),
        [
            runtime,
            result.data,
        ]
    );
    const data = useSyncExternalStore(
        runtime.entityStore.subscribeAll,
        getSnapshot,
        getSnapshot
    );

    return {
        data,
        isPending: result.isPending,
        error: result.error,
        refetch: result.refetch,
    };
}
