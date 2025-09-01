import type { EntityRef, SchemaSummary } from '../../../core/entities';
import type { ReadOptions, SchemaRepo } from '../../ports/repos';
import type { Query } from '..';

export class ListSchemas implements Query<Record<string, never>, SchemaSummary[]> {
    readonly name = 'list_schemas';

    constructor(private readonly repo: SchemaRepo) {}

    execute(
        _input: Record<string, never>,
        options?: ReadOptions
    ): Promise<SchemaSummary[]> {
        return this.repo.list(options);
    }

    reads(): EntityRef[] {
        return [
            'schema',
        ];
    }
}
