import type { EntityRef } from '../../../core/entities';
import type { EndedSession, SessionRepo } from '../../ports/repos';
import type { Command } from '..';

export class EndSession implements Command<Record<string, never>, EndedSession> {
    constructor(private readonly repo: SessionRepo) {}

    execute(): Promise<EndedSession> {
        return this.repo.end();
    }

    writes(): EntityRef[] {
        return [];
    }
}
