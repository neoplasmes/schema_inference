import type { Entity, EntityRecord, NormalizedValue } from './types';

type Memo = {
    version: number;
    value: Record<string, unknown>;
};

/** Stores normalized confirmed data and reconstructs identified entity graphs. */
export class EntityStore {
    private readonly base = new Map<string, EntityRecord>();
    private readonly memo = new Map<string, Memo>();
    private records = new Map<string, EntityRecord>();

    get<T extends object = Entity>(ref: string): T | undefined {
        const record = this.records.get(ref);

        if (!record) {
            return undefined;
        }

        const version = 0;
        const cached = this.memo.get(ref);

        if (cached?.version === version) {
            return cached.value as T;
        }

        const value: Record<string, unknown> = {};
        this.memo.set(ref, {
            version,
            value,
        });

        for (const [key, field] of Object.entries(record)) {
            Object.defineProperty(value, key, {
                configurable: false,
                enumerable: true,
                writable: false,
                value: this.denormalize(field),
            });
        }

        Object.freeze(value);

        return value as T;
    }

    upsert(ref: string, partial: object): void {
        this.normalize({
            ...partial,
            ref,
        });
    }

    remove(ref: string): void {
        this.base.delete(ref);
        this.publish();
    }

    normalize(value: unknown): NormalizedValue {
        const staged = new Map(this.base);
        const normalized = this.encode(value, staged, new WeakSet());

        for (const [ref, record] of staged) {
            this.base.set(ref, record);
        }

        this.publish();

        return normalized;
    }

    denormalize<T = unknown>(value: NormalizedValue): T {
        if (value.kind === 'entity') {
            return this.get(value.ref) as T;
        }

        if (value.kind === 'value') {
            return value.value as T;
        }

        if (value.kind === 'array') {
            return Object.freeze(
                value.items
                    .filter(item => item.kind !== 'entity' || this.records.has(item.ref))
                    .map(item => this.denormalize(item))
            ) as T;
        }

        return Object.freeze(
            Object.fromEntries(
                Object.entries(value.fields).map(([key, field]) => [
                    key,
                    this.denormalize(field),
                ])
            )
        ) as T;
    }

    get size(): number {
        return this.records.size;
    }

    private encode(
        value: unknown,
        destination: Map<string, EntityRecord | null>,
        visiting: WeakSet<object>
    ): NormalizedValue {
        if (value === null || typeof value !== 'object') {
            return {
                kind: 'value',
                value,
            };
        }

        const object = value as Record<string, unknown>;
        const entity = !Array.isArray(value) && typeof object.ref === 'string';

        if (visiting.has(value)) {
            if (entity) {
                return {
                    kind: 'entity',
                    ref: object.ref as string,
                };
            }

            throw new TypeError('Cyclic value objects must have an entity ref.');
        }

        visiting.add(value);

        try {
            if (Array.isArray(value)) {
                return {
                    kind: 'array',
                    items: value.map(item => this.encode(item, destination, visiting)),
                };
            }

            if (
                Object.getPrototypeOf(value) !== Object.prototype &&
                Object.getPrototypeOf(value) !== null
            ) {
                throw new TypeError('Cached values must be plain data.');
            }

            const fields: Record<string, NormalizedValue> = Object.create(null) as Record<
                string,
                NormalizedValue
            >;

            for (const [key, field] of Object.entries(object)) {
                if (!entity || field !== undefined) {
                    fields[key] = this.encode(field, destination, visiting);
                }
            }

            if (entity) {
                const ref = object.ref as string;
                destination.set(ref, {
                    ...destination.get(ref),
                    ...fields,
                });

                return {
                    kind: 'entity',
                    ref,
                };
            }

            return {
                kind: 'object',
                fields,
            };
        } finally {
            visiting.delete(value);
        }
    }

    private publish(): void {
        this.records = new Map(this.base);
        this.memo.clear();
    }
}
