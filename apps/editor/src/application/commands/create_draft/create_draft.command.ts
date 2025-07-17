import type { SchemaDocument } from '../../../core/schema';
import type { SchemaReference } from '../../../core/schema_reference';
import type { EditorResource, SchemaRepository } from '../../ports/repos/schema.repo';

export class CreateDraftCommand {
    constructor(private readonly repository: SchemaRepository) {}

    execute(
        input: Extract<EditorResource, { kind: 'analysis' }>
    ): Promise<SchemaDocument> {
        return this.repository.createFromAnalysis(input);
    }

    writes(
        _input: Extract<EditorResource, { kind: 'analysis' }>,
        output: SchemaDocument
    ): readonly SchemaReference[] {
        return [{ type: 'schema.document', id: output.snapshot.id }];
    }
}
