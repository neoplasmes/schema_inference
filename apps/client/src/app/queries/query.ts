import type { EntityRef } from '../../core/entities';
import type { ReadOptions } from '../ports/repos';

export interface Query<I, O> {
    readonly name: string;
    execute(input: I, options?: ReadOptions): Promise<O>;
    reads(input: I): EntityRef[];
}
