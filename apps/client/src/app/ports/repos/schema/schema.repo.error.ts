export class SchemaNotFoundError extends Error {
    constructor(id: string) {
        super(`Schema ${id} was not found.`);
        this.name = 'SchemaNotFoundError';
    }
}
