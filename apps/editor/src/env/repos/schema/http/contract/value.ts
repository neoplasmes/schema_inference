import { ContractViolationError } from './contract_violation.error';

type ObjectValue = Record<string, unknown>;

export function object(value: unknown): ObjectValue {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new ContractViolationError('Invalid schema API object.');
    }

    return value as ObjectValue;
}

export function string(value: unknown): string {
    if (typeof value !== 'string') {
        throw new ContractViolationError('Invalid schema API string.');
    }

    return value;
}

export function nullableString(value: unknown): string | null {
    return value === null ? null : string(value);
}

export function count(value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        throw new ContractViolationError('Invalid schema API count.');
    }

    return value;
}

export function boolean(value: unknown): boolean {
    if (typeof value !== 'boolean') {
        throw new ContractViolationError('Invalid schema API boolean.');
    }

    return value;
}

export function array(value: unknown): unknown[] {
    if (!Array.isArray(value)) {
        throw new ContractViolationError('Invalid schema API array.');
    }

    return value;
}

export function version(value: ObjectValue): void {
    if (value.contractVersion !== 2) {
        throw new ContractViolationError('Unsupported schema API contract version.');
    }
}
