import type { Analysis, EntityRef } from '../../../core/entities';
import type { AnalysisRepo, ReadOptions } from '../../ports/repos';
import type { Query } from '..';

export class ListAnalyses implements Query<Record<string, never>, Analysis[]> {
    readonly name = 'list_analyses';

    constructor(private readonly repo: AnalysisRepo) {}

    execute(_input: Record<string, never>, options?: ReadOptions): Promise<Analysis[]> {
        return this.repo.list(options);
    }

    reads(): EntityRef[] {
        return [
            'analysis',
        ];
    }
}
