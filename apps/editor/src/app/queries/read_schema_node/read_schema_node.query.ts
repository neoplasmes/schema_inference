import type { SchemaNode } from '../../../core/entities/schema';
import type { Query } from '../../contracts';
import type { EntityRef } from '../../../core/entities';
import type { Snapshot } from '../../../core/entities/schema';
import type { ReadOptions, SchemaRepository } from '../../ports/repos/schema';

export type ReadSchemaNodeInput = {
    snapshot: Snapshot;
    nodeId: string;
};

export class ReadSchemaNodeQuery implements Query<ReadSchemaNodeInput, SchemaNode> {
    readonly name = 'schema.node';

    constructor(private readonly repository: SchemaRepository) {}

    execute(input: ReadSchemaNodeInput, options?: ReadOptions) {
        return this.repository.readNode(input.snapshot, input.nodeId, options);
    }

    reads(input: ReadSchemaNodeInput): readonly EntityRef[] {
        return [
            `schema.node:${input.snapshot.id}/${input.snapshot.revision}/${input.nodeId}`,
        ];
    }
}
