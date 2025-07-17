import type { SchemaReference } from '../../../core/schema_reference';
import type {
    EditorResource,
    ReadOptions,
    SchemaRepository,
} from '../../ports/repos/schema.repo';

export class OpenSchemaQuery {
    readonly name = 'schema.open';

    constructor(private readonly repository: SchemaRepository) {}

    execute(input: Extract<EditorResource, { kind: 'schema' }>, options?: ReadOptions) {
        return this.repository.open(input, options);
    }

    reads(
        input: Extract<EditorResource, { kind: 'schema' }>
    ): readonly SchemaReference[] {
        return [{ type: 'schema.document', id: input.schemaId }];
    }
}
