export class ContractViolationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ContractViolationError';
    }
}
