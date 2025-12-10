import type { EntityRef } from '../../../core/entities';
import type { AnalysisRepo } from '../../ports/repos';
import type { Command } from '..';

export interface DeleteAnalysisInput {
    analysisId: string;
}

export class DeleteAnalysis implements Command<DeleteAnalysisInput, void> {
    constructor(private readonly repo: AnalysisRepo) {}

    execute(input: DeleteAnalysisInput): Promise<void> {
        return this.repo.remove(input.analysisId);
    }

    writes(input: DeleteAnalysisInput): EntityRef[] {
        return [
            'analysis',
            `analysis:${input.analysisId}`,
        ];
    }
}
