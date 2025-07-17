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
