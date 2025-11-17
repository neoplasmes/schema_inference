import type { EntityRef, SchemaSummary } from '../../../core/entities';
import type { RecordSchemaSavedInput, SchemaRepo } from '../../ports/repos/schema';
import type { Command } from '..';

export class RecordSchemaSaved implements Command<RecordSchemaSavedInput, SchemaSummary> {
    constructor(private readonly repo: SchemaRepo) {}

    execute(input: RecordSchemaSavedInput): Promise<SchemaSummary> {
        return this.repo.recordSaved(input);
    }

    writes(_input: RecordSchemaSavedInput, output: SchemaSummary): EntityRef[] {
        return [
            'schema',
            `schema:${output.id}`,
        ];
    }
}
