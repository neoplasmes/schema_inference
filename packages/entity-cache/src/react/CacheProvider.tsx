import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { CacheRuntime } from './cacheRuntime';

const CacheContext = createContext<CacheRuntime | null>(null);

export function CacheProvider({
    runtime,
    children,
}: {
    runtime: CacheRuntime;
    children: ReactNode;
}) {
    return (
        <CacheContext.Provider value={runtime}>
            <QueryClientProvider client={runtime.queryClient}>
                {children}
            </QueryClientProvider>
        </CacheContext.Provider>
    );
}

export function useCacheRuntime(): CacheRuntime {
    const runtime = useContext(CacheContext);

    if (!runtime) {
        throw new Error('CacheProvider is required.');
    }

    return runtime;
}
