import type { Analysis, EntityRef } from '../../../core/entities';
import type { AnalysisRepo, ReadOptions } from '../../ports/repos';
import type { Query } from '..';

export class GetAnalysis
    implements
        Query<
            {
                id: string;
            },
            Analysis
        >
{
    readonly name = 'get_analysis';

    constructor(private readonly repo: AnalysisRepo) {}

    execute(
        input: {
            id: string;
        },
        options?: ReadOptions
    ): Promise<Analysis> {
        return this.repo.getById(input.id, options);
    }

    reads(input: { id: string }): EntityRef[] {
        return [
            `analysis:${input.id}`,
            'document',
        ];
    }
}
