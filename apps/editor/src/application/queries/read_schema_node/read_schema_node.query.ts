import type { SchemaReference } from '../../../core/schema_reference';
import type { Snapshot } from '../../../core/schema';
import type { ReadOptions, SchemaRepository } from '../../ports/repos/schema.repo';

export class ReadSchemaNodeQuery {
    readonly name = 'schema.node';

    constructor(private readonly repository: SchemaRepository) {}

    execute(input: { snapshot: Snapshot; nodeId: string }, options?: ReadOptions) {
        return this.repository.readNode(input.snapshot, input.nodeId, options);
    }

    reads(input: { snapshot: Snapshot; nodeId: string }): readonly SchemaReference[] {
        return [
            {
                type: 'schema.node',
                id: `${input.snapshot.id}/${input.snapshot.revision}/${input.nodeId}`,
            },
        ];
    }
}
