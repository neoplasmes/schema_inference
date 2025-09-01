import type { Analysis, DocumentInput } from '../../../../core/entities';
import type { ReadOptions } from '..';

export interface CreateAnalysisInput {
    title: string;
    documents: readonly DocumentInput[];
    idempotencyKey: string;
}

export interface AnalysisRepo {
    create(input: CreateAnalysisInput): Promise<Analysis>;
    getById(id: string, options?: ReadOptions): Promise<Analysis>;
}
