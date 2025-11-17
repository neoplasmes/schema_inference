import { useMutation } from '@tanstack/react-query';
import { useCacheRuntime } from './CacheProvider';
import type { Command, CommandOptions } from './contracts';

export function useCommand<I, O>(
    command: Command<I, O>,
    options: CommandOptions<I> = {}
) {
    const runtime = useCacheRuntime();
    const mutation = useMutation({
        mutationFn: (input: I) => runtime.execute(command, input, options),
    });

    return {
        execute: mutation.mutateAsync,
        isPending: mutation.isPending,
        error: mutation.error,
        data: mutation.data,
    };
}
