export class ContractViolationError extends Error {
    constructor(field: string) {
        super(`The response contains an invalid ${field}.`);
        this.name = 'ContractViolationError';
    }
}
