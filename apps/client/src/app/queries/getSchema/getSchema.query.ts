import type { EntityRef, SchemaSummary } from '../../../core/entities';
import type { ReadOptions, SchemaRepo } from '../../ports/repos';
import type { Query } from '..';

export class GetSchema
    implements
        Query<
            {
                id: string;
            },
            SchemaSummary
        >
{
    readonly name = 'get_schema';

    constructor(private readonly repo: SchemaRepo) {}

    execute(
        input: {
            id: string;
        },
        options?: ReadOptions
    ): Promise<SchemaSummary> {
        return this.repo.getById(input.id, options);
    }

    reads(input: { id: string }): EntityRef[] {
        return [
            `schema:${input.id}`,
        ];
    }
}
