import { ContractViolationError } from './contract.error';

export function record(value: unknown, field: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new ContractViolationError(field);
    }

    return value as Record<string, unknown>;
}

export function text(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new ContractViolationError(field);
    }

    return value;
}

export function integer(value: unknown, field: string): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        throw new ContractViolationError(field);
    }

    return value;
}

export function timestamp(value: unknown, field: string): string {
    const result = text(value, field);

    if (!Number.isFinite(Date.parse(result))) {
        throw new ContractViolationError(field);
    }

    return result;
}

export function array(value: unknown, field: string): unknown[] {
    if (!Array.isArray(value)) {
        throw new ContractViolationError(field);
    }

    return value;
}
