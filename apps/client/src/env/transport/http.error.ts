export class HttpError extends Error {
    constructor(
        readonly status: number,
        readonly body: unknown
    ) {
        super(`Request failed with status ${status}.`);
        this.name = 'HttpError';
    }
}
