import type { Analysis, SourceDocument } from '../../../core/entities';
import {
    array,
    ContractViolationError,
    integer,
    record,
    text,
    timestamp,
} from '../contract';

function mapDocument(value: unknown): SourceDocument {
    const dto = record(value, 'document');
    const id = text(dto.id, 'document.id');
    const format = dto.format;

    if (format !== 'xml' && format !== 'yaml' && format !== 'json') {
        throw new ContractViolationError('document.format');
    }

    return {
        ref: `document:${id}`,
        id,
        name: text(dto.name, 'document.name'),
        format,
        size: integer(dto.size, 'document.size'),
        content: text(dto.content, 'document.content'),
    };
}

export function mapAnalysis(value: unknown): Analysis {
    const dto = record(value, 'analysis');
    const id = text(dto.id, 'analysis.id');
    const status = dto.status;
    const progress = integer(dto.progress, 'analysis.progress');

    if (
        ![
            'queued',
            'processing',
            'completed',
            'failed',
        ].includes(String(status)) ||
        progress > 100
    ) {
        throw new ContractViolationError('analysis.status or progress');
    }

    if (dto.error !== null && typeof dto.error !== 'string') {
        throw new ContractViolationError('analysis.error');
    }

    const documents = array(dto.documents, 'analysis.documents').map(mapDocument);

    if (
        documents.length === 0 ||
        new Set(documents.map(document => document.id)).size !== documents.length
    ) {
        throw new ContractViolationError('analysis.documents');
    }

    return {
        ref: `analysis:${id}`,
        id,
        title: text(dto.title, 'analysis.title'),
        status: status as Analysis['status'],
        progress,
        revision: text(dto.revision, 'analysis.revision'),
        createdAt: timestamp(dto.created_at, 'analysis.created_at'),
        documents,
        error: dto.error,
    };
}
