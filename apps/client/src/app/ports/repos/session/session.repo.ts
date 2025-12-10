import type { Session } from '../../../../core/entities';
import type { ReadOptions } from '..';

export interface EndedSession {
    endSessionUrl: string;
}

export interface SessionRepo {
    getCurrent(options?: ReadOptions): Promise<Session>;
    end(): Promise<EndedSession>;
}
