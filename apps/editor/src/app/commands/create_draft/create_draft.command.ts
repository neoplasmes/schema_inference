import type { Command } from '../../contracts';
import type { SchemaDocument } from '../../../core/entities/schema';
import type { EntityRef } from '../../../core/entities';
import type { CreateDraftInput, SchemaRepository } from '../../ports/repos/schema';

export type { CreateDraftInput } from '../../ports/repos/schema';

export class CreateDraftCommand implements Command<CreateDraftInput, SchemaDocument> {
    constructor(private readonly repository: SchemaRepository) {}

    execute(input: CreateDraftInput): Promise<SchemaDocument> {
        return this.repository.createFromAnalysis(input);
    }

    writes(_input: CreateDraftInput, output: SchemaDocument): readonly EntityRef[] {
        return [`schema.document:${output.snapshot.id}`];
    }
}
