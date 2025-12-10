import type { EntityRef } from '../../../core/entities';
import type { RemoveSchemaInput, SchemaRepo } from '../../ports/repos';
import type { Command } from '..';

export class DeleteSchema implements Command<RemoveSchemaInput, void> {
    constructor(private readonly repo: SchemaRepo) {}

    execute(input: RemoveSchemaInput): Promise<void> {
        return this.repo.remove(input);
    }

    writes(input: RemoveSchemaInput): EntityRef[] {
        return [
            'schema',
            `schema:${input.schemaId}`,
        ];
    }
}
