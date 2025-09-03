import type { SchemaSummary } from '../../../core/entities';
import { integer, record, text, timestamp } from '../contract';

export function mapSchema(value: unknown): SchemaSummary {
    const dto = record(value, 'schema');
    const id = text(dto.id, 'schema.id');

    return {
        ref: `schema:${id}`,
        id,
        title: text(dto.title, 'schema.title'),
        revision: text(dto.revision, 'schema.revision'),
        updatedAt: timestamp(dto.updated_at, 'schema.updated_at'),
        documentCount: integer(dto.document_count, 'schema.document_count'),
    };
}
