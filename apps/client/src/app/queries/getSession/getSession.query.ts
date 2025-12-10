import type { EntityRef, Session } from '../../../core/entities';
import type { ReadOptions, SessionRepo } from '../../ports/repos';
import type { Query } from '..';

export class GetSession implements Query<Record<string, never>, Session> {
    readonly name = 'get_session';

    constructor(private readonly repo: SessionRepo) {}

    execute(_input: Record<string, never>, options?: ReadOptions): Promise<Session> {
        return this.repo.getCurrent(options);
    }

    reads(): EntityRef[] {
        return [
            'session:current',
        ];
    }
}
