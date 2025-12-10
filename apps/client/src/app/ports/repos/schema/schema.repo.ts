import type { SchemaSummary } from '../../../../core/entities';
import type { ReadOptions } from '..';

export interface RecordSchemaSavedInput {
    schemaId: string;
    revision: string;
    savedAt?: string;
    title?: string;
    documentCount?: number;
}

export interface RemoveSchemaInput {
    schemaId: string;
    revision: string;
}

export interface SchemaRepo {
    list(options?: ReadOptions): Promise<SchemaSummary[]>;
    getById(id: string, options?: ReadOptions): Promise<SchemaSummary>;
    recordSaved(input: RecordSchemaSavedInput): Promise<SchemaSummary>;
    remove(input: RemoveSchemaInput): Promise<void>;
}
