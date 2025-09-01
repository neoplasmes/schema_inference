export class AnalysisNotFoundError extends Error {
    constructor(id: string) {
        super(`Analysis ${id} was not found.`);
        this.name = 'AnalysisNotFoundError';
    }
}
