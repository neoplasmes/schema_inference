import { EntityStore, references, type NormalizedValue } from '@app/entity-cache/store';
import type {
    ChangeReceipt,
    CreateDraftInput,
    EditorResource,
    MemberPage,
    ReadOptions,
    SchemaRepository,
} from '../../../app/ports/repos/schema';
import type {
    DocumentOperation,
    NodeSummary,
    SchemaMember,
    Snapshot,
} from '../../../core/entities/schema';

type CachedPage = {
    value: NormalizedValue;
    release(): void;
};

type StoredPage = Omit<MemberPage, 'items'> & {
    items: readonly {
        member: {
            ref: string;
            value: SchemaMember;
        };
        valueSummary: {
            ref: string;
            value: NodeSummary;
        };
    }[];
};

type PendingPage = {
    controller: AbortController;
    consumers: Set<symbol>;
    promise: Promise<MemberPage>;
};

/** Shares immutable pages while each consumer keeps independent cancellation ownership. */
export class CachedSchemaRepository implements SchemaRepository {
    private readonly pages = new Map<string, CachedPage>();
    private readonly pending = new Map<string, PendingPage>();

    constructor(
        private readonly repository: SchemaRepository,
        private readonly pageLimit = 64,
        private readonly store = new EntityStore()
    ) {
        if (!Number.isSafeInteger(pageLimit) || pageLimit < 1) {
            throw new Error('The page cache limit must be a positive integer.');
        }
    }

    open(
        resource: Extract<
            EditorResource,
            {
                kind: 'schema';
            }
        >,
        options?: ReadOptions
    ) {
        return this.repository.open(resource, options);
    }

    createFromAnalysis(resource: CreateDraftInput) {
        return this.repository.createFromAnalysis(resource);
    }

    readNode(snapshot: Snapshot, nodeId: string, options?: ReadOptions) {
        return this.repository.readNode(snapshot, nodeId, options);
    }

    readMembers(
        snapshot: Snapshot,
        collectionId: string,
        cursor: string | null,
        options?: ReadOptions
    ): Promise<MemberPage> {
        const signal = options?.signal;

        if (signal?.aborted) {
            return Promise.reject(aborted());
        }

        const key = JSON.stringify([
            snapshot.resource,
            snapshot.id,
            snapshot.revision,
            collectionId,
            null,
            cursor,
            50,
        ]);
        const cached = this.pages.get(key);

        if (cached) {
            this.pages.delete(key);
            this.pages.set(key, cached);

            return Promise.resolve(this.readPage(cached));
        }

        let entry = this.pending.get(key);

        if (!entry || entry.controller.signal.aborted) {
            const controller = new AbortController();
            const consumers = new Set<symbol>();
            const promise = this.repository
                .readMembers(snapshot, collectionId, cursor, {
                    signal: controller.signal,
                })
                .then(page => {
                    if (!controller.signal.aborted) {
                        const value = this.store.normalize({
                            ...page,
                            items: page.items.map(item => ({
                                member: {
                                    ref: entityRef(
                                        page.snapshot,
                                        'member',
                                        item.member.id
                                    ),
                                    value: item.member,
                                },
                                valueSummary: {
                                    ref: entityRef(
                                        page.snapshot,
                                        'summary',
                                        item.valueSummary.id
                                    ),
                                    value: item.valueSummary,
                                },
                            })),
                        });
                        const release = this.store.retain(references(value));
                        this.pages.get(key)?.release();
                        this.pages.set(key, {
                            value,
                            release,
                        });

                        while (this.pages.size > this.pageLimit) {
                            const oldest = this.pages.keys().next().value;

                            if (oldest !== undefined) {
                                this.pages.get(oldest)?.release();
                                this.pages.delete(oldest);
                            }
                        }

                        this.store.sweep();
                    }

                    return page;
                })
                .finally(() => {
                    if (this.pending.get(key)?.controller === controller) {
                        this.pending.delete(key);
                    }
                });
            entry = {
                controller,
                consumers,
                promise,
            };
            this.pending.set(key, entry);
        }

        return subscribe(entry, signal);
    }

    save(
        snapshot: Snapshot,
        mutationId: string,
        operations: readonly DocumentOperation[]
    ): Promise<ChangeReceipt> {
        return this.repository.save(snapshot, mutationId, operations);
    }

    readChange(
        schemaId: string,
        changeId: string,
        options?: ReadOptions
    ): Promise<ChangeReceipt> {
        return this.repository.readChange(schemaId, changeId, options);
    }

    clear(): void {
        this.pages.forEach(page => page.release());
        this.pages.clear();
        this.store.sweep();

        for (const entry of this.pending.values()) {
            entry.controller.abort();
        }

        this.pending.clear();
    }

    get cachedPageCount(): number {
        return this.pages.size;
    }

    private readPage(cached: CachedPage): MemberPage {
        const page = this.store.denormalize<StoredPage>(cached.value);

        return {
            ...page,
            items: page.items.map(item => ({
                member: item.member.value,
                valueSummary: item.valueSummary.value,
            })),
        };
    }
}

function entityRef(snapshot: Snapshot, kind: 'member' | 'summary', id: string): string {
    return `schema.${kind}:${JSON.stringify([
        snapshot.resource,
        snapshot.id,
        snapshot.revision,
        id,
    ])}`;
}

function aborted(): DOMException {
    return new DOMException('The schema page read was cancelled.', 'AbortError');
}

function subscribe(entry: PendingPage, signal?: AbortSignal): Promise<MemberPage> {
    const consumer = Symbol();
    entry.consumers.add(consumer);

    return new Promise((resolve, reject) => {
        let settled = false;

        function release(): void {
            settled = true;
            entry.consumers.delete(consumer);
            signal?.removeEventListener('abort', cancel);
            entry.controller.signal.removeEventListener('abort', cancel);
        }

        function cancel(): void {
            if (settled) {
                return;
            }

            release();
            reject(aborted());

            if (entry.consumers.size === 0) {
                entry.controller.abort();
            }
        }

        signal?.addEventListener('abort', cancel, {
            once: true,
        });
        entry.controller.signal.addEventListener('abort', cancel, {
            once: true,
        });
        entry.promise.then(
            page => {
                if (!settled) {
                    release();
                    resolve(page);
                }
            },
            error => {
                if (!settled) {
                    release();
                    reject(error);
                }
            }
        );
    });
}
