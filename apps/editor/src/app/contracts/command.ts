import type { EntityRef } from '../../core/entities';

export interface Command<Input, Output> {
    execute(input: Input): Promise<Output>;
    writes(input: Input, output: Output): readonly EntityRef[];
}
