import type { BoardModel } from '../../../../../board';
import { projectEvidence } from '../../lib/evidence';
import { projectDocument } from '../../lib/projection';
import { emptyModel, type Session } from './session';

export type SessionProjection = {
    session: Session | null;
    version: number;
    error: string | null;
    demo: boolean;
};

export function projectSession({
    session,
    version,
    error,
    demo,
}: SessionProjection): BoardModel {
    if (!session) {
        return {
            ...emptyModel,
            state: error ? ('failed' as const) : ('loading' as const),
        };
    }

    const projection = projectDocument(
        session.document,
        session.view,
        session.template,
        version
    );

    return demo
        ? projectEvidence(projection, session.view, session.template)
        : projection;
}
