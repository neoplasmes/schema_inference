import type { Entity, EntityPatch } from '../store';

export type Query<I, O> = Readonly<{
    name: string;
    execute(
        input: I,
        options?: {
            signal?: AbortSignal;
        }
    ): Promise<O>;
    reads(input: I): readonly string[];
}>;

export type Command<I, O> = Readonly<{
    execute(input: I): Promise<O>;
    writes(input: I, output: O): readonly string[];
}>;

export type CommandOptions<I> = Readonly<{
    optimistic?: (
        input: I,
        current: (ref: string) => Entity | undefined
    ) => readonly EntityPatch[];
}>;

export type ReadSettings = Readonly<{
    enabled?: boolean;
    refetchInterval?: number | false;
}>;
