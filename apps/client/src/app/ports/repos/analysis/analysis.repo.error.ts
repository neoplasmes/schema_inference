export class AnalysisNotFoundError extends Error {
    constructor(id: string) {
        super(`Analysis ${id} was not found.`);
        this.name = 'AnalysisNotFoundError';
    }
}

export class AnalysisNotReadyError extends Error {
    constructor(id: string) {
        super(`Analysis ${id} has not finished yet.`);
        this.name = 'AnalysisNotReadyError';
    }
}
