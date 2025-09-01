import type { Analysis, EntityRef } from '../../../core/entities';
import type { AnalysisRepo, CreateAnalysisInput } from '../../ports/repos/analysis';
import type { Command } from '..';
import { InvalidAnalysisInputError } from './create_analysis.command.error';

export class CreateAnalysis implements Command<CreateAnalysisInput, Analysis> {
    constructor(private readonly repo: AnalysisRepo) {}

    execute(input: CreateAnalysisInput): Promise<Analysis> {
        if (
            !input.title.trim() ||
            !input.idempotencyKey ||
            input.documents.length === 0
        ) {
            throw new InvalidAnalysisInputError(
                'Choose at least one document and provide a title.'
            );
        }

        if (
            input.documents.some(document => !document.name || !document.content.trim())
        ) {
            throw new InvalidAnalysisInputError(
                'Documents must have a name and contain text.'
            );
        }

        return this.repo.create({
            ...input,
            title: input.title.trim(),
        });
    }

    writes(_input: CreateAnalysisInput, output: Analysis): EntityRef[] {
        return [
            'analysis',
            `analysis:${output.id}`,
            'document',
            ...output.documents.map(document => document.ref),
        ];
    }
}
