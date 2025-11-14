import {
    createMoveEdit,
    createRenameEdit,
    projectCollections,
    type DocumentEdit,
    type DocumentEditState,
} from '../../../core/processes/document_edit';
import type {
    DocumentOperation,
    MemberSummary,
    SchemaDocument,
    SchemaNode,
} from '../../../core/entities/schema';
import type { MemberPage } from '../../ports/repos/schema';

export type CollectionWindow = Readonly<{
    collectionId: string;
    state: 'notRequested' | 'loading' | 'partial' | 'complete' | 'failed';
    items: readonly MemberSummary[];
    totalItems: number;
    nextCursor: string | null;
    firstIndex?: number;
    loadedItems?: number;
    hasGaps?: boolean;
    error?: string;
}>;

/** Keeps immutable base pages separate from semantic edits and their inverses. */
export class EditorDocument {
    private readonly nodeValues = new Map<string, SchemaNode>();
    private readonly collectionWindows = new Map<string, CollectionWindow>();
    private edits: DocumentOperation[] = [];
    private history: DocumentEdit[] = [];
    private historyPosition = 0;
    private readonly offsets = new Map<string, number>();
    private pendingSave: Readonly<{
        id: string;
        count: number;
    }> | null = null;

    constructor(
        private manifestValue: SchemaDocument,
        private readonly rowWindowLimit = 100
    ) {
        if (!Number.isSafeInteger(rowWindowLimit) || rowWindowLimit < 1) {
            throw new Error('The row window limit must be a positive integer.');
        }
    }

    get nodes(): ReadonlyMap<string, SchemaNode> {
        return this.nodeValues;
    }

    get collections(): ReadonlyMap<string, CollectionWindow> {
        return this.collectionWindows;
    }

    get manifest(): SchemaDocument {
        return this.manifestValue;
    }

    integrateNode(node: SchemaNode): void {
        this.nodeValues.set(node.id, node);
    }

    integrateNodes(nodes: Iterable<SchemaNode>): void {
        for (const node of nodes) {
            this.integrateNode(node);
        }
    }

    setCollectionLoadState(
        collectionId: string,
        state: CollectionWindow['state'],
        error?: string
    ): CollectionWindow {
        const previous = this.collectionWindows.get(collectionId);

        if (!previous) {
            throw new Error('Load the collection before changing its loading state.');
        }

        const window = {
            ...previous,
            state,
            error,
        };
        this.collectionWindows.set(collectionId, window);

        return window;
    }

    get operations(): readonly DocumentOperation[] {
        return this.edits;
    }

    get canUndo(): boolean {
        return this.historyPosition > 0;
    }

    get canRedo(): boolean {
        return this.historyPosition < this.history.length;
    }

    addPage(
        page: MemberPage,
        mode: 'append' | 'replace' = 'append',
        retainedMembers: ReadonlySet<string> = new Set()
    ): void {
        const { snapshot } = this.manifest;

        if (
            page.snapshot.id !== snapshot.id ||
            page.snapshot.revision !== snapshot.revision
        ) {
            throw new Error('The page belongs to another schema revision.');
        }

        const previous = this.collectionWindows.get(page.collectionId);
        const pinned = this.pinnedMembers();
        retainedMembers.forEach(memberId => pinned.add(memberId));
        const baseItems =
            mode === 'replace'
                ? previous?.items.filter(row => pinned.has(row.member.id))
                : previous?.items;
        const items = new Map(
            baseItems?.map(row => [
                row.member.id,
                row,
            ])
        );
        let added = 0;

        for (const row of page.items) {
            if (!items.has(row.member.id)) {
                added += 1;
            }

            items.set(row.member.id, row);
        }

        const visited =
            mode === 'replace'
                ? page.items.length
                : (this.offsets.get(page.collectionId) ?? 0) + added;
        this.offsets.set(page.collectionId, visited);
        const allItems = [
            ...items.values(),
        ];
        const windowStart = Math.max(0, allItems.length - this.rowWindowLimit);
        const retained = allItems.filter(
            (row, index) => index >= windowStart || pinned.has(row.member.id)
        );
        const pageIds = new Set(page.items.map(row => row.member.id));
        const retainedOutsidePage = retained.some(row => !pageIds.has(row.member.id));
        const hasGaps =
            retained.length > Math.min(allItems.length, this.rowWindowLimit) ||
            (retainedOutsidePage && (mode === 'replace' || previous?.hasGaps === true));

        this.collectionWindows.set(page.collectionId, {
            collectionId: page.collectionId,
            state: page.nextCursor === null ? 'complete' : 'partial',
            items: retained,
            totalItems: page.totalItems,
            nextCursor: page.nextCursor,
            firstIndex: hasGaps ? undefined : Math.max(0, visited - retained.length),
            loadedItems: retained.length,
            hasGaps,
        });
    }

    projectedCollections(): ReadonlyMap<string, CollectionWindow> {
        return projectCollections(this.collectionWindows, this.edits);
    }

    rename(memberId: string, name: string): void {
        const edit = createRenameEdit(this.editState(), memberId, name);

        if (edit) {
            this.append(edit);
        }
    }

    move(
        memberId: string,
        targetCollectionId: string,
        beforeMemberId: string | null
    ): void {
        const edit = createMoveEdit(
            this.editState(),
            memberId,
            targetCollectionId,
            beforeMemberId
        );

        if (edit) {
            this.append(edit);
        }
    }

    undo(): void {
        if (!this.canUndo) {
            return;
        }

        this.historyPosition -= 1;
        this.edits.push(this.history[this.historyPosition].inverse);
    }

    redo(): void {
        if (!this.canRedo) {
            return;
        }

        this.edits.push(this.history[this.historyPosition].forward);
        this.historyPosition += 1;
    }

    beginSave(id: string): Readonly<{
        id: string;
        operations: readonly DocumentOperation[];
    }> {
        if (!this.pendingSave) {
            this.pendingSave = {
                id,
                count: this.edits.length,
            };
        }

        return {
            id: this.pendingSave.id,
            operations: this.edits.slice(0, this.pendingSave.count),
        };
    }

    confirmSave(revision: string, mutationId?: string): void {
        if (!this.pendingSave) {
            throw new Error('No save is awaiting confirmation.');
        }

        if (mutationId !== undefined && mutationId !== this.pendingSave.id) {
            throw new Error('The server confirmed a different save operation.');
        }

        const confirmed = this.edits.slice(0, this.pendingSave.count);

        for (const [id, window] of projectCollections(
            this.collectionWindows,
            confirmed
        )) {
            this.collectionWindows.set(id, window);
        }

        for (const operation of confirmed) {
            if (operation.kind === 'renameXmlName' && operation.target.kind === 'node') {
                const node = this.nodeValues.get(operation.target.id);

                if (node?.kind === 'xmlElement') {
                    this.nodeValues.set(node.id, {
                        ...node,
                        name: operation.name,
                    });
                }
            }
        }

        this.edits = this.edits.slice(this.pendingSave.count);
        this.pendingSave = null;
        this.manifestValue = {
            ...this.manifest,
            snapshot: {
                ...this.manifest.snapshot,
                revision,
            },
        };
    }

    /** Releases only a definitively rejected write; uncertain writes keep their retry identity. */
    failSave(mutationId?: string): void {
        if (!this.pendingSave) {
            return;
        }

        if (mutationId !== undefined && this.pendingSave?.id !== mutationId) {
            throw new Error('The server rejected a different save operation.');
        }

        this.pendingSave = null;
    }

    private append(edit: DocumentEdit): void {
        this.edits.push(edit.forward);
        this.history = this.history.slice(0, this.historyPosition);
        this.history.push(edit);
        this.history = this.history.slice(-100);
        this.historyPosition = this.history.length;
    }

    private editState(): DocumentEditState {
        return {
            nodes: this.nodeValues,
            collections: new Map(
                [
                    ...this.projectedCollections(),
                ].map(([id, window]) => [
                    id,
                    {
                        collectionId: window.collectionId,
                        items: window.items,
                        totalItems: window.totalItems,
                        available: window.state !== 'notRequested',
                        complete: window.state === 'complete',
                        contiguous: !window.hasGaps,
                    },
                ])
            ),
        };
    }

    private pinnedMembers(): Set<string> {
        const result = new Set<string>();
        const operations = [
            ...this.edits,
            ...this.history.flatMap(edit => [
                edit.forward,
                edit.inverse,
            ]),
        ];

        for (const operation of operations) {
            if (operation.kind === 'renameXmlName') {
                if (operation.target.kind === 'member') {
                    result.add(operation.target.id);
                }

                for (const window of this.collectionWindows.values()) {
                    for (const row of window.items) {
                        if (row.member.valueNodeId === operation.target.id) {
                            result.add(row.member.id);
                        }
                    }
                }
            } else {
                result.add(operation.memberId);

                if (operation.kind === 'moveMember' && operation.beforeMemberId) {
                    result.add(operation.beforeMemberId);
                }
            }
        }

        return result;
    }
}
