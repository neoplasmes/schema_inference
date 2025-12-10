import type { Entity } from '..';

export interface Session extends Entity {
    readonly sub: string;
    readonly roles: readonly string[];
}
