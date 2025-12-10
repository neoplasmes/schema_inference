import type { EndedSession, ReadOptions, SessionRepo } from '../../../app/ports/repos';
import type { Session } from '../../../core/entities';
import { HttpError } from '../../transport';
import type { InterceptableHttpTransport } from '../../transport';
import { record, text } from '../contract';
import { mapSession } from './session.mapper';

export class TransportSessionRepo implements SessionRepo {
    constructor(private readonly http: InterceptableHttpTransport) {}

    attachInterceptors(onUnauthenticated: () => void): void {
        this.http.addErrorInterceptor(error => {
            if (error instanceof HttpError && error.status === 401) {
                onUnauthenticated();
            }
        });
    }

    async getCurrent(options?: ReadOptions): Promise<Session> {
        return mapSession(
            await this.http.request('/api/v2/session', {
                signal: options?.signal,
            })
        );
    }

    async end(): Promise<EndedSession> {
        const data = record(
            await this.http.request('/api/v2/session', {
                method: 'DELETE',
            }),
            'session.end'
        );

        return {
            endSessionUrl: text(data.endSessionUrl, 'session.endSessionUrl'),
        };
    }
}
