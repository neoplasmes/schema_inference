import type { EntityRef } from '../../core/entities';
import type { ReadOptions } from './read_options';

export interface Query<Input, Output> {
    readonly name: string;
    execute(input: Input, options?: ReadOptions): Promise<Output>;
    reads(input: Input): readonly EntityRef[];
}
