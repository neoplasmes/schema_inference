export class SchemaNotFoundError extends Error {
    constructor(id: string) {
        super(`Schema ${id} was not found.`);
        this.name = 'SchemaNotFoundError';
    }
}

export class SchemaRevisionConflictError extends Error {
    constructor(id: string) {
        super(`Schema ${id} changed since it was loaded. Refresh and try again.`);
        this.name = 'SchemaRevisionConflictError';
    }
}
