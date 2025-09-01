import type { Entity } from '..';
import type { SourceDocument } from '../document';

export interface Analysis extends Entity {
    readonly id: string;
    readonly title: string;
    readonly status: 'queued' | 'processing' | 'completed' | 'failed';
    readonly progress: number;
    readonly revision: string;
    readonly documents: readonly SourceDocument[];
    readonly createdAt: string;
    readonly error: string | null;
}
