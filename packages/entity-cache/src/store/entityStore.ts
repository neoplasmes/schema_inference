import { createStore } from 'zustand/vanilla';
import type {
    Entity,
    EntityPatch,
    EntityRecord,
    NormalizedValue,
    OptimisticLayer,
} from './types';
import { recordReferences, sameRecord } from './values';

type LayerState = {
    entries: Map<string, EntityRecord | null>;
    active: boolean;
};
type Memo = {
    version: number;
    value: Record<string, unknown>;
};

/** Stores confirmed entities separately from ordered optimistic changes and retained reads. */
export class EntityStore {
    private readonly base = new Map<string, EntityRecord>();
    private readonly layers: LayerState[] = [];
    private readonly roots = new Map<symbol, readonly string[]>();
    private readonly versions = new Map<string, number>();
    private readonly memo = new Map<string, Memo>();
    private readonly state = createStore(() => ({
        version: 0,
    }));
    private records = new Map<string, EntityRecord>();
    private depth = 0;
    private dirty = false;

    get<T extends object = Entity>(ref: string): T | undefined {
        const record = this.records.get(ref);

        if (!record) {
            return undefined;
        }

        const version = this.versions.get(ref) ?? 0;
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
        this.changed();
    }

    normalize(value: unknown): NormalizedValue {
        return this.transaction(() => {
            const staged = new Map(this.base);
            const normalized = this.encode(value, staged, new WeakSet());

            for (const [ref, record] of staged) {
                this.base.set(ref, record);
            }

            this.changed();

            return normalized;
        });
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

    subscribe(ref: string, listener: () => void): () => void {
        let previous = this.get(ref);

        return this.state.subscribe(() => {
            const current = this.get(ref);

            if (current !== previous) {
                previous = current;
                listener();
            }
        });
    }

    subscribeAll = (listener: () => void): (() => void) => {
        return this.state.subscribe(listener);
    };

    getVersion = (): number => {
        return this.state.getState().version;
    };

    begin(): OptimisticLayer {
        const layer: LayerState = {
            entries: new Map(),
            active: true,
        };
        this.layers.push(layer);

        return {
            apply: patches => {
                if (!layer.active) {
                    return;
                }

                this.transaction(() => {
                    const staged: LayerState = {
                        entries: new Map(layer.entries),
                        active: true,
                    };

                    for (const patch of patches) {
                        this.applyPatch(staged, patch);
                    }

                    layer.entries = staged.entries;
                    this.changed();
                });
            },
            discard: () => {
                if (!layer.active) {
                    return;
                }

                layer.active = false;
                this.layers.splice(this.layers.indexOf(layer), 1);
                this.changed();
            },
        };
    }

    retain(refs: readonly string[]): () => void {
        const owner = Symbol();
        this.roots.set(owner, [
            ...refs,
        ]);

        return () => {
            this.roots.delete(owner);
        };
    }

    sweep(): void {
        const marked = new Set<string>();
        const pending = [
            ...this.roots.values(),
        ].flat();

        for (const layer of this.layers) {
            pending.push(...layer.entries.keys());
        }

        while (pending.length > 0) {
            const ref = pending.pop()!;

            if (marked.has(ref)) {
                continue;
            }

            marked.add(ref);
            const base = this.base.get(ref);

            if (base) {
                pending.push(...recordReferences(base));
            }

            for (const layer of this.layers) {
                const record = layer.entries.get(ref);

                if (record) {
                    pending.push(...recordReferences(record));
                }
            }
        }

        for (const ref of this.base.keys()) {
            if (!marked.has(ref)) {
                this.base.delete(ref);
            }
        }

        this.changed();
    }

    clear(): void {
        this.base.clear();
        this.roots.clear();
        this.layers.forEach(layer => {
            layer.active = false;
        });
        this.layers.length = 0;
        this.changed();
    }

    transaction<T>(operation: () => T): T {
        this.depth += 1;

        try {
            return operation();
        } finally {
            this.depth -= 1;

            if (this.depth === 0 && this.dirty) {
                this.publish();
            }
        }
    }

    get size(): number {
        return this.records.size;
    }

    private applyPatch(layer: LayerState, patch: EntityPatch): void {
        if ('remove' in patch) {
            layer.entries.set(patch.ref, null);

            return;
        }

        this.encode(
            {
                ...patch.patch,
                ref: patch.ref,
            },
            layer.entries,
            new WeakSet()
        );
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

    private changed(): void {
        this.dirty = true;

        if (this.depth === 0) {
            this.publish();
        }
    }

    private publish(): void {
        this.dirty = false;
        const next = new Map(this.base);

        for (const layer of this.layers) {
            for (const [ref, record] of layer.entries) {
                if (record === null) {
                    next.delete(ref);
                } else {
                    next.set(ref, {
                        ...next.get(ref),
                        ...record,
                    });
                }
            }
        }

        const changed = new Set<string>();
        const dependants = new Map<string, Set<string>>();

        for (const [ref, record] of [
            ...this.records,
            ...next,
        ]) {
            for (const child of recordReferences(record)) {
                const owners = dependants.get(child) ?? new Set<string>();
                owners.add(ref);
                dependants.set(child, owners);
            }
        }

        for (const ref of new Set([
            ...this.records.keys(),
            ...next.keys(),
        ])) {
            const previous = this.records.get(ref);
            const current = next.get(ref);

            if (previous && current && sameRecord(previous, current)) {
                next.set(ref, previous);
            } else {
                changed.add(ref);
            }
        }

        const pending = [
            ...changed,
        ];

        while (pending.length > 0) {
            for (const parent of dependants.get(pending.pop()!) ?? []) {
                if (!changed.has(parent)) {
                    changed.add(parent);
                    pending.push(parent);
                }
            }
        }

        this.records = next;

        if (changed.size === 0) {
            return;
        }

        for (const ref of changed) {
            if (next.has(ref)) {
                this.versions.set(ref, (this.versions.get(ref) ?? 0) + 1);
            } else {
                this.versions.delete(ref);
            }

            this.memo.delete(ref);
        }

        this.state.setState(state => ({
            version: state.version + 1,
        }));
    }
}
