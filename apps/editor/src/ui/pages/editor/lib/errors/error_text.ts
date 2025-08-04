import {
    SchemaRepositoryError,
    SchemaWriteRejectedError,
} from '../../../../../app/ports/repos/schema';

export function errorText(reason: unknown): string {
    if (reason instanceof SchemaRepositoryError) {
        switch (reason.reason) {
            case 'unavailable':
                return 'The schema API is unavailable or this resource no longer exists. The editor requires API v2.';
            case 'alternative_required':
                return 'Choose a root alternative before creating a draft.';
        }
    }

    if (reason instanceof SchemaWriteRejectedError) {
        return reason.reason === 'conflict'
            ? 'The schema has changed on the server. Your local edits are preserved; reconcile before saving.'
            : 'The server rejected these schema edits. Correct them before saving again.';
    }

    if (
        reason instanceof Error &&
        'status' in reason &&
        typeof reason.status === 'number'
    ) {
        return `The schema request failed (${reason.status}). Your local edits are preserved.`;
    }

    return reason instanceof Error ? reason.message : 'The schema operation failed.';
}
