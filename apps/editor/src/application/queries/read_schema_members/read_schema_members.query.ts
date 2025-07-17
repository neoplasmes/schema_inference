import type { SchemaReference } from '../../../core/schema_reference';
import type { Snapshot } from '../../../core/schema';
import type { ReadOptions, SchemaRepository } from '../../ports/repos/schema.repo';

export class ReadSchemaMembersQuery {
    readonly name = 'schema.members';

    constructor(private readonly repository: SchemaRepository) {}

    execute(
        input: { snapshot: Snapshot; collectionId: string; cursor: string | null },
        options?: ReadOptions
    ) {
        return this.repository.readMembers(
            input.snapshot,
            input.collectionId,
            input.cursor,
            options
        );
    }

    reads(input: {
        snapshot: Snapshot;
        collectionId: string;
    }): readonly SchemaReference[] {
        return [
            {
                type: 'schema.collection',
                id: `${input.snapshot.id}/${input.snapshot.revision}/${input.collectionId}`,
            },
        ];
    }
}
