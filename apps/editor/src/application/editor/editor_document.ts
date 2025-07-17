import {
    memberName,
    type DocumentOperation,
    type MemberSummary,
    type SchemaDocument,
    type SchemaNode,
} from '../../core/schema';
import type { MemberPage } from '../ports/repos/schema.repo';

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

type Edit = Readonly<{ forward: DocumentOperation; inverse: DocumentOperation }>;

/** Keeps immutable base pages separate from semantic edits and their inverses. */
export class EditorDocument {
    readonly nodes = new Map<string, SchemaNode>();
    readonly collections = new Map<string, CollectionWindow>();
    private edits: DocumentOperation[] = [];
    private history: Edit[] = [];
    private historyPosition = 0;
    private readonly offsets = new Map<string, number>();
    private pendingSave: Readonly<{ id: string; count: number }> | null = null;

    constructor(
        public manifest: SchemaDocument,
        private readonly rowWindowLimit = 100
    ) {
        if (!Number.isSafeInteger(rowWindowLimit) || rowWindowLimit < 1) {
            throw new Error('The row window limit must be a positive integer.');
        }
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

        const previous = this.collections.get(page.collectionId);
        const pinned = this.pinnedMembers();
        retainedMembers.forEach(memberId => pinned.add(memberId));
        const baseItems =
            mode === 'replace'
                ? previous?.items.filter(row => pinned.has(row.member.id))
                : previous?.items;
        const items = new Map(baseItems?.map(row => [row.member.id, row]));
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
        const allItems = [...items.values()];
        const windowStart = Math.max(0, allItems.length - this.rowWindowLimit);
        const retained = allItems.filter(
            (row, index) => index >= windowStart || pinned.has(row.member.id)
        );
        const pageIds = new Set(page.items.map(row => row.member.id));
        const retainedOutsidePage = retained.some(row => !pageIds.has(row.member.id));
        const hasGaps =
            retained.length > Math.min(allItems.length, this.rowWindowLimit) ||
            (retainedOutsidePage && (mode === 'replace' || previous?.hasGaps === true));

        this.collections.set(page.collectionId, {
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
        const result = new Map(this.collections);

        for (const operation of this.edits) {
            applyOperation(result, operation);
        }

        return result;
    }

    rename(memberId: string, name: string): void {
        const found = findMember(this.projectedCollections(), memberId);

        if (!found) {
            throw new Error('Load the field before renaming it.');
        }

        const { row } = found;
        const previousName = memberName(row);

        if (name === previousName) {
            return;
        }

        if (row.member.kind === 'property') {
            this.append(
                { kind: 'renameProperty', memberId, name },
                { kind: 'renameProperty', memberId, name: previousName }
            );

            return;
        }

        if (row.member.kind === 'xmlAttribute') {
            const target = { kind: 'member' as const, id: memberId };

            this.append(
                {
                    kind: 'renameXmlName',
                    target,
                    name: { ...row.member.name, localName: name },
                },
                { kind: 'renameXmlName', target, name: row.member.name }
            );

            return;
        }

        const node = this.nodes.get(row.member.valueNodeId);

        if (row.member.kind !== 'xmlParticle' || node?.kind !== 'xmlElement') {
            throw new Error('Load the XML element before renaming it.');
        }

        const target = { kind: 'node' as const, id: node.id };

        this.append(
            { kind: 'renameXmlName', target, name: { ...node.name, localName: name } },
            {
                kind: 'renameXmlName',
                target,
                name: { ...node.name, localName: previousName },
            }
        );
    }

    move(
        memberId: string,
        targetCollectionId: string,
        beforeMemberId: string | null
    ): void {
        const windows = this.projectedCollections();
        const found = findMember(windows, memberId);
        const target = windows.get(targetCollectionId);

        if (!found || !target || target.state === 'notRequested') {
            throw new Error('Load both collections before moving a field.');
        }

        if (found.window.hasGaps || target.hasGaps) {
            throw new Error(
                'Load a contiguous field window before reordering pinned edits across unloaded rows.'
            );
        }

        if (beforeMemberId === memberId) {
            return;
        }

        if (
            beforeMemberId !== null &&
            !target.items.some(row => row.member.id === beforeMemberId)
        ) {
            throw new Error('The destination field is not loaded.');
        }

        const owner = [...this.nodes.values()].find(
            node =>
                (node.kind === 'object' && node.properties.id === targetCollectionId) ||
                (node.kind === 'xmlComplex' &&
                    node.attributes.id === targetCollectionId) ||
                (node.kind === 'xmlGroup' && node.particles.id === targetCollectionId) ||
                (node.kind === 'union' && node.options.id === targetCollectionId)
        );
        const allowed =
            owner &&
            ((owner.kind === 'object' && found.row.member.kind === 'property') ||
                (owner.kind === 'xmlComplex' &&
                    found.row.member.kind === 'xmlAttribute') ||
                (owner.kind === 'xmlGroup' && found.row.member.kind === 'xmlParticle') ||
                (owner.kind === 'union' && found.row.member.kind === 'option'));

        if (!allowed) {
            throw new Error('This collection cannot contain that kind of field.');
        }

        if (
            targetCollectionId !== found.window.collectionId &&
            found.row.valueSummary.kind !== 'scalar' &&
            found.row.valueSummary.kind !== 'ref'
        ) {
            this.checkMoveAncestry(found.row.member.valueNodeId, owner.id, windows);
        }

        const index = found.window.items.findIndex(row => row.member.id === memberId);
        const next = found.window.items[index + 1]?.member.id ?? null;

        if (next === null && found.window.state !== 'complete') {
            throw new Error(
                'Load the next page to preserve the original field order for undo.'
            );
        }

        this.append(
            { kind: 'moveMember', memberId, targetCollectionId, beforeMemberId },
            {
                kind: 'moveMember',
                memberId,
                targetCollectionId: found.window.collectionId,
                beforeMemberId: next,
            }
        );
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

    beginSave(
        id: string
    ): Readonly<{ id: string; operations: readonly DocumentOperation[] }> {
        if (!this.pendingSave) {
            this.pendingSave = { id, count: this.edits.length };
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

        for (const operation of this.edits.slice(0, this.pendingSave.count)) {
            applyOperation(this.collections, operation);

            if (operation.kind === 'renameXmlName' && operation.target.kind === 'node') {
                const node = this.nodes.get(operation.target.id);

                if (node?.kind === 'xmlElement') {
                    this.nodes.set(node.id, { ...node, name: operation.name });
                }
            }
        }

        this.edits = this.edits.slice(this.pendingSave.count);
        this.pendingSave = null;
        this.manifest = {
            ...this.manifest,
            snapshot: { ...this.manifest.snapshot, revision },
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

    private append(forward: DocumentOperation, inverse: DocumentOperation): void {
        this.edits.push(forward);
        this.history = this.history.slice(0, this.historyPosition);
        this.history.push({ forward, inverse });
        this.history = this.history.slice(-100);
        this.historyPosition = this.history.length;
    }

    private pinnedMembers(): Set<string> {
        const result = new Set<string>();
        const operations = [
            ...this.edits,
            ...this.history.flatMap(edit => [edit.forward, edit.inverse]),
        ];

        for (const operation of operations) {
            if (operation.kind === 'renameXmlName') {
                if (operation.target.kind === 'member') {
                    result.add(operation.target.id);
                }

                for (const window of this.collections.values()) {
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

    /** A contained field cannot become its own ancestor; references are not containment edges. */
    private checkMoveAncestry(
        sourceNodeId: string,
        targetNodeId: string,
        windows: ReadonlyMap<string, CollectionWindow>
    ): void {
        const pending = [sourceNodeId];
        const visited = new Set<string>();
        let incomplete = false;

        while (pending.length > 0) {
            const id = pending.pop();

            if (id === undefined || visited.has(id)) {
                continue;
            }

            if (id === targetNodeId) {
                throw new Error('A field cannot be moved into its own descendants.');
            }

            visited.add(id);
            const node = this.nodes.get(id);

            if (!node) {
                incomplete = true;
                continue;
            }

            if (node.kind === 'xmlElement') {
                pending.push(node.contentNodeId);
            }
            if (node.kind === 'xmlComplex' && node.particleNodeId) {
                pending.push(node.particleNodeId);
            }
            if (node.kind === 'array') {
                pending.push(node.itemsNodeId);
            }

            const collection =
                node.kind === 'object'
                    ? node.properties
                    : node.kind === 'xmlComplex'
                      ? node.attributes
                      : node.kind === 'xmlGroup'
                        ? node.particles
                        : node.kind === 'union'
                          ? node.options
                          : null;

            if (collection) {
                const window = windows.get(collection.id);

                if (
                    window?.state !== 'complete' ||
                    window.items.length !== window.totalItems
                ) {
                    incomplete = true;
                }

                for (const row of window?.items ?? []) {
                    if (
                        row.valueSummary.kind !== 'scalar' &&
                        row.valueSummary.kind !== 'ref'
                    ) {
                        pending.push(row.member.valueNodeId);
                    }
                }
            }
        }

        if (incomplete) {
            throw new Error(
                'Load the source branch before moving it between collections so its ancestry can be checked.'
            );
        }
    }
}

function findMember(windows: ReadonlyMap<string, CollectionWindow>, memberId: string) {
    for (const window of windows.values()) {
        const row = window.items.find(item => item.member.id === memberId);

        if (row) {
            return { window, row };
        }
    }

    return null;
}

function applyOperation(
    windows: Map<string, CollectionWindow>,
    operation: DocumentOperation
): void {
    if (operation.kind === 'moveMember') {
        const found = findMember(windows, operation.memberId);
        const target = windows.get(operation.targetCollectionId);

        if (!found || !target) {
            return;
        }

        const sameCollection = found.window.collectionId === target.collectionId;
        windows.set(found.window.collectionId, {
            ...found.window,
            items: found.window.items.filter(row => row.member.id !== operation.memberId),
            totalItems: found.window.totalItems - (sameCollection ? 0 : 1),
        });
        const items = [...(windows.get(target.collectionId)?.items ?? [])];
        const index =
            operation.beforeMemberId === null
                ? items.length
                : items.findIndex(row => row.member.id === operation.beforeMemberId);

        items.splice(index < 0 ? items.length : index, 0, found.row);
        windows.set(target.collectionId, {
            ...target,
            items,
            totalItems: target.totalItems + (sameCollection ? 0 : 1),
        });

        return;
    }

    for (const [id, window] of windows) {
        const items = window.items.map(row => {
            if (
                operation.kind === 'renameProperty' &&
                row.member.id === operation.memberId &&
                row.member.kind === 'property'
            ) {
                return { ...row, member: { ...row.member, name: operation.name } };
            }

            if (operation.kind === 'renameXmlName') {
                if (
                    operation.target.kind === 'member' &&
                    row.member.id === operation.target.id &&
                    row.member.kind === 'xmlAttribute'
                ) {
                    return { ...row, member: { ...row.member, name: operation.name } };
                }

                if (
                    operation.target.kind === 'node' &&
                    row.valueSummary.id === operation.target.id
                ) {
                    return {
                        ...row,
                        valueSummary: {
                            ...row.valueSummary,
                            label: operation.name.localName,
                        },
                    };
                }
            }

            return row;
        });

        windows.set(id, { ...window, items });
    }
}
