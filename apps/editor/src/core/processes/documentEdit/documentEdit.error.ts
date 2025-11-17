export class DocumentEditError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'DocumentEditError';
    }
}
