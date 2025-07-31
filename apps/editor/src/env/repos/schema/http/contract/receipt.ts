import type { ChangeReceipt } from '../../../../../app/ports/repos/schema';
import { ContractViolationError } from './contract_violation.error';
import { object, string } from './value';

export function parseReceipt(value: unknown): ChangeReceipt {
    const data = object(value);
    const status = data.status;

    if (
        status !== 'pending' &&
        status !== 'applied' &&
        status !== 'failed' &&
        status !== 'conflicted'
    ) {
        throw new ContractViolationError('Unsupported changeset status.');
    }

    return {
        id: string(data.id),
        clientMutationId: string(data.clientMutationId),
        status,
        revision: data.result == null ? null : string(object(data.result).revision),
        error: typeof data.error === 'string' ? data.error : null,
    };
}
