import type { MemberPage } from '../../ports/repos/schema';
import type { Query } from '../../contracts';
import type { EntityRef } from '../../../core/entities';
import type { Snapshot } from '../../../core/entities/schema';
import type { ReadOptions, SchemaRepository } from '../../ports/repos/schema';

export type ReadSchemaMembersInput = {
    snapshot: Snapshot;
    collectionId: string;
    cursor: string | null;
};

export class ReadSchemaMembersQuery implements Query<ReadSchemaMembersInput, MemberPage> {
    readonly name = 'schema.members';

    constructor(private readonly repository: SchemaRepository) {}

    execute(input: ReadSchemaMembersInput, options?: ReadOptions) {
        return this.repository.readMembers(
            input.snapshot,
            input.collectionId,
            input.cursor,
            options
        );
    }

    reads(input: { snapshot: Snapshot; collectionId: string }): readonly EntityRef[] {
        return [
            `schema.collection:${input.snapshot.id}/${input.snapshot.revision}/${input.collectionId}`,
        ];
    }
}
