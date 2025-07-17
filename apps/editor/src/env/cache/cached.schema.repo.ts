import type {
    ChangeReceipt,
    EditorResource,
    MemberPage,
    ReadOptions,
    SchemaRepository,
} from '../../application/ports/repos/schema.repo';
import type { DocumentOperation, Snapshot } from '../../core/schema';

type PendingPage = {
    controller: AbortController;
    consumers: Set<symbol>;
    promise: Promise<MemberPage>;
};

/** Shares immutable pages while each consumer keeps independent cancellation ownership. */
export class CachedSchemaRepository implements SchemaRepository {
    private readonly pages = new Map<string, MemberPage>();
    private readonly pending = new Map<string, PendingPage>();

    constructor(
        private readonly repository: SchemaRepository,
        private readonly pageLimit = 64
    ) {
        if (!Number.isSafeInteger(pageLimit) || pageLimit < 1) {
            throw new Error('The page cache limit must be a positive integer.');
        }
    }

    open(resource: Extract<EditorResource, { kind: 'schema' }>, options?: ReadOptions) {
        return this.repository.open(resource, options);
    }

    createFromAnalysis(resource: Extract<EditorResource, { kind: 'analysis' }>) {
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

            return Promise.resolve(cached);
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
                        this.pages.set(key, page);

                        while (this.pages.size > this.pageLimit) {
                            const oldest = this.pages.keys().next().value;

                            if (oldest !== undefined) {
                                this.pages.delete(oldest);
                            }
                        }
                    }

                    return page;
                })
                .finally(() => {
                    if (this.pending.get(key)?.controller === controller) {
                        this.pending.delete(key);
                    }
                });
            entry = { controller, consumers, promise };
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
        this.pages.clear();

        for (const entry of this.pending.values()) {
            entry.controller.abort();
        }

        this.pending.clear();
    }

    get cachedPageCount(): number {
        return this.pages.size;
    }
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

        signal?.addEventListener('abort', cancel, { once: true });
        entry.controller.signal.addEventListener('abort', cancel, { once: true });
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
