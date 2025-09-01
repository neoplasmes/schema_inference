import type { Entity } from '..';

export interface SchemaSummary extends Entity {
    readonly id: string;
    readonly title: string;
    readonly revision: string;
    readonly updatedAt: string;
    readonly documentCount: number;
}
