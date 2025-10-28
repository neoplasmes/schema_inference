import { AnalysisNotFoundError } from '../../../app/ports/repos/analysis';
import type {
    AnalysisRepo,
    CreateAnalysisInput,
} from '../../../app/ports/repos/analysis';
import type { ReadOptions } from '../../../app/ports/repos';
import type { Analysis } from '../../../core/entities';
import { HttpError } from '../../transport';
import type { HttpTransport } from '../../transport';
import { ContractViolationError } from '../contract';
import { mapAnalysis } from './analysis.mapper';

export class TransportAnalysisRepo implements AnalysisRepo {
    constructor(private readonly http: HttpTransport) {}

    async create(input: CreateAnalysisInput): Promise<Analysis> {
        const data = await this.http.request('/api/v2/analyses', {
            method: 'POST',
            body: JSON.stringify({
                title: input.title,
                documents: input.documents,
            }),
            headers: {
                'Content-Type': 'application/json',
                'Idempotency-Key': input.idempotencyKey,
            },
        });

        return mapAnalysis(data);
    }

    async getById(id: string, options?: ReadOptions): Promise<Analysis> {
        try {
            const data = await this.http.request(
                `/api/v2/analyses/${encodeURIComponent(id)}`,
                {
                    signal: options?.signal,
                }
            );
            const analysis = mapAnalysis(data);

            if (analysis.id !== id) {
                throw new ContractViolationError('analysis.id');
            }

            return analysis;
        } catch (error) {
            if (error instanceof HttpError && error.status === 404) {
                throw new AnalysisNotFoundError(id);
            }

            throw error;
        }
    }
}
