import type { SchemaDocument } from '../../../core/entities/schema';
import type { Query } from '../../contracts';
import type { EntityRef } from '../../../core/entities';
import type {
    EditorResource,
    ReadOptions,
    SchemaRepository,
} from '../../ports/repos/schema';

export type OpenSchemaInput = Extract<
    EditorResource,
    {
        kind: 'schema';
    }
>;

export class OpenSchemaQuery implements Query<OpenSchemaInput, SchemaDocument> {
    readonly name = 'schema.open';

    constructor(private readonly repository: SchemaRepository) {}

    execute(input: OpenSchemaInput, options?: ReadOptions) {
        return this.repository.open(input, options);
    }

    reads(input: OpenSchemaInput): readonly EntityRef[] {
        return [
            `schema.document:${input.schemaId}`,
        ];
    }
}
