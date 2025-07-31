/** A definitive rejection may release a mutation; transport failures must preserve it. */
export class SchemaWriteRejectedError extends Error {
    constructor(
        public readonly reason: 'invalid' | 'conflict',
        message: string
    ) {
        super(message);
        this.name = 'SchemaWriteRejectedError';
    }
}

export class SchemaRepositoryError extends Error {
    constructor(
        public readonly reason: 'unavailable' | 'alternative_required',
        message: string,
        public readonly status?: number
    ) {
        super(message);
        this.name = 'SchemaRepositoryError';
    }
}
