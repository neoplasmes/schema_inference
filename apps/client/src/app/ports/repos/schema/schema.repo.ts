import type { SchemaSummary } from '../../../../core/entities';
import type { ReadOptions } from '..';

export interface RecordSchemaSavedInput {
    schemaId: string;
    revision: string;
    savedAt?: string;
    title?: string;
    documentCount?: number;
}

export interface SchemaRepo {
    list(options?: ReadOptions): Promise<SchemaSummary[]>;
    getById(id: string, options?: ReadOptions): Promise<SchemaSummary>;
    recordSaved(input: RecordSchemaSavedInput): Promise<SchemaSummary>;
}
