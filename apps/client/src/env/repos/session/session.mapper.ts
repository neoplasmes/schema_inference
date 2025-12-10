import type { Session } from '../../../core/entities';
import { array, record, text } from '../contract';

export function mapSession(value: unknown): Session {
    const dto = record(value, 'session');

    return {
        ref: 'session:current',
        sub: text(dto.sub, 'session.sub'),
        roles: array(dto.roles, 'session.roles').map((role, index) =>
            text(role, `session.roles.${index}`)
        ),
    };
}
