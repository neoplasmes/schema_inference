import type { ChangeReceipt } from '../../ports/repos/schema';
import type { Query } from '../../contracts';
import type { EntityRef } from '../../../core/entities';
import type { ReadOptions, SchemaRepository } from '../../ports/repos/schema';

export type ReadSchemaChangeInput = { schemaId: string; changeId: string };

export class ReadSchemaChangeQuery
    implements Query<ReadSchemaChangeInput, ChangeReceipt>
{
    readonly name = 'schema.change';

    constructor(private readonly repository: SchemaRepository) {}

    execute(input: ReadSchemaChangeInput, options?: ReadOptions) {
        return this.repository.readChange(input.schemaId, input.changeId, options);
    }

    reads(input: { schemaId: string }): readonly EntityRef[] {
        return [`schema.document:${input.schemaId}`];
    }
}
