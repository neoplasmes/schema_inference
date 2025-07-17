import type { SchemaReference } from '../../../core/schema_reference';
import type { ReadOptions, SchemaRepository } from '../../ports/repos/schema.repo';

export class ReadSchemaChangeQuery {
    readonly name = 'schema.change';

    constructor(private readonly repository: SchemaRepository) {}

    execute(input: { schemaId: string; changeId: string }, options?: ReadOptions) {
        return this.repository.readChange(input.schemaId, input.changeId, options);
    }

    reads(input: { schemaId: string }): readonly SchemaReference[] {
        return [{ type: 'schema.document', id: input.schemaId }];
    }
}
