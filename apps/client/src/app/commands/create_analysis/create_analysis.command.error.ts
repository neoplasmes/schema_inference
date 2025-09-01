export class InvalidAnalysisInputError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'InvalidAnalysisInputError';
    }
}
