export class HttpResponseError extends Error {
    constructor(readonly status: number) {
        super(`HTTP request failed (${status}).`);
        this.name = 'HttpResponseError';
    }
}
