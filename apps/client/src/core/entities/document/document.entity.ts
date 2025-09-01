import type { Entity } from '..';

export type DocumentFormat = 'xml' | 'yaml' | 'json';

export interface DocumentInput {
    readonly name: string;
    readonly format: DocumentFormat;
    readonly size: number;
    readonly content: string;
}

export interface SourceDocument extends Entity, DocumentInput {
    readonly id: string;
}
