import { SchemaNotFoundError } from '../../../app/ports/repos/schema';
import type { RecordSchemaSavedInput, SchemaRepo } from '../../../app/ports/repos/schema';
import type { ReadOptions } from '../../../app/ports/repos';
import type { SchemaSummary } from '../../../core/entities';
import { HttpError } from '../../transport';
import type { HttpTransport } from '../../transport';
import { array, ContractViolationError } from '../contract';
import { mapSchema } from './schema.mapper';

export class TransportSchemaRepo implements SchemaRepo {
    constructor(private readonly http: HttpTransport) {}

    async list(options?: ReadOptions): Promise<SchemaSummary[]> {
        const data = await this.http.request('/api/v2/schemas', {
            signal: options?.signal,
        });

        return array(data, 'schemas').map(mapSchema);
    }

    async getById(id: string, options?: ReadOptions): Promise<SchemaSummary> {
        try {
            const data = await this.http.request(
                `/api/v2/schemas/${encodeURIComponent(id)}`,
                {
                    signal: options?.signal,
                }
            );
            const schema = mapSchema(data);

            if (schema.id !== id) {
                throw new ContractViolationError('schema.id');
            }

            return schema;
        } catch (error) {
            if (error instanceof HttpError && error.status === 404) {
                throw new SchemaNotFoundError(id);
            }

            throw error;
        }
    }

    recordSaved(input: RecordSchemaSavedInput): Promise<SchemaSummary> {
        return this.getById(input.schemaId);
    }
}
