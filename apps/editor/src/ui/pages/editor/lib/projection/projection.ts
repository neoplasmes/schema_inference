import type {
    CollectionWindow,
    EditorDocument,
} from '../../../../../app/editor/document';
import type { LoadedBranch } from '../../../../../app/queries/load_branch';
import type {
    BoardCard,
    BoardConnection,
    BoardModel,
    BoardRow,
    BoardSelection,
    Point,
} from '../../../../../board';
import {
    memberName,
    nodeCollections,
    type MemberSummary,
} from '../../../../../core/entities/schema';

export type BranchView = Readonly<{
    blockId: string;
    rootNodeId: string;
    title: string;
    collectionIds: readonly string[];
}>;

export type EditorView = {
    selection: BoardSelection | null;
    positions: Map<string, Point>;
    collapsed: Set<string>;
    expanded: Map<string, boolean>;
    variants: Map<string, string>;
    branches: Map<string, BranchView>;
    connections: BoardConnection[];
};

export function branchView(
    branch: LoadedBranch,
    blockId = branch.rootNodeId
): BranchView {
    return {
        blockId,
        rootNodeId: branch.rootNodeId,
        title: branch.title,
        collectionIds: branch.nodes.flatMap(node =>
            nodeCollections(node).map(collection => collection.id)
        ),
    };
}

export function initialView(model: BoardModel): EditorView {
    return {
        selection: model.selection,
        positions: new Map(),
        collapsed: new Set(),
        expanded: new Map(),
        variants: new Map(),
        branches: new Map(),
        connections: [
            ...model.connections,
        ],
    };
}

function rowView(item: MemberSummary, template?: BoardRow): BoardRow {
    const member = item.member;
    const occurrenceLabel =
        member.kind === 'xmlParticle'
            ? member.minOccurs === member.maxOccurs
                ? String(member.minOccurs)
                : `${member.minOccurs}..${member.maxOccurs ?? '∞'}`
            : member.kind === 'property' || member.kind === 'xmlAttribute'
              ? member.required
                  ? '1'
                  : '0..1'
              : undefined;

    return {
        memberId: member.id,
        typeLabel: template?.typeLabel ?? item.valueSummary.kind,
        occurrenceLabel: template?.occurrenceLabel ?? occurrenceLabel,
        icon:
            member.kind === 'xmlAttribute'
                ? 'attribute'
                : item.valueSummary.kind === 'ref'
                  ? 'reference'
                  : item.valueSummary.kind === 'scalar'
                    ? 'scalar'
                    : 'element',
        change: 'unchanged',
        expandable:
            item.valueSummary.directMemberCount > 0 || item.valueSummary.kind === 'ref',
        expanded: false,
        ...template,
        nameAlias: template?.nameAlias,
        name: memberName(item),
    };
}

export function projectDocument(
    document: EditorDocument,
    view: EditorView,
    template: BoardModel,
    version: number
): BoardModel {
    const windows = document.projectedCollections();
    const rowTemplates = new Map(
        template.cards.flatMap(card =>
            card.rows.map(
                row =>
                    [
                        row.memberId,
                        row,
                    ] as const
            )
        )
    );
    const cards: BoardCard[] = [];
    const definitions: {
        template?: BoardCard;
        branch: BranchView;
    }[] = template.cards.map(card => ({
        template: card,
        branch: {
            blockId: card.blockId,
            rootNodeId: card.nodeId,
            title: card.title,
            collectionIds: [
                `${card.collectionId}/attributes`,
                card.collectionId ?? `members-${card.blockId}`,
            ],
        },
    }));

    for (const branch of view.branches.values()) {
        if (
            !definitions.some(definition => definition.branch.blockId === branch.blockId)
        ) {
            definitions.push({
                branch,
            });
        }
    }

    const branchesByNode = new Map(
        definitions.map(definition => [
            definition.branch.rootNodeId,
            definition.branch,
        ])
    );

    for (const definition of definitions) {
        const { branch, template: card } = definition;
        const collections = branch.collectionIds
            .map(id => windows.get(id))
            .filter((window): window is CollectionWindow => window !== undefined);
        const items = collections.flatMap(collection => collection.items);
        const preferred =
            collections.find(
                collection => collection.collectionId === card?.collectionId
            ) ?? collections.at(-1);
        const primary =
            collections.find(collection => collection.state === 'loading') ??
            collections.find(collection => collection.state === 'failed') ??
            collections.find(collection => collection.nextCursor !== null) ??
            preferred;
        const totalItems = collections.reduce(
            (count, collection) => count + collection.totalItems,
            0
        );
        const truncated = collections.some(
            collection => collection.hasGaps || (collection.firstIndex ?? 0) > 0
        );
        const countedWindow =
            primary?.state === 'partial' || primary?.state === 'failed' || truncated;
        const loadedItems =
            card?.rowWindow.loadedItems ??
            (countedWindow
                ? collections.reduce(
                      (count, collection) =>
                          count + (collection.loadedItems ?? collection.items.length),
                      0
                  )
                : undefined);
        const contiguous =
            !collections.some(collection => collection.hasGaps) &&
            collections.filter(collection => collection.totalItems > 0).length === 1;
        const firstIndex =
            card?.rowWindow.firstIndex ??
            (contiguous && primary?.firstIndex ? primary.firstIndex : undefined);
        const rootNode = document.nodes.get(branch.rootNodeId);
        let title =
            rootNode?.kind === 'xmlElement' ? rootNode.name.localName : branch.title;

        for (const operation of document.operations) {
            if (
                operation.kind === 'renameXmlName' &&
                operation.target.kind === 'node' &&
                operation.target.id === branch.rootNodeId
            ) {
                title = operation.name.localName;
            }
        }

        cards.push({
            blockId: branch.blockId,
            nodeId: branch.rootNodeId,
            suggested: false,
            ...card,
            collectionId: primary?.collectionId ?? card?.collectionId ?? null,
            position: view.positions.get(branch.blockId) ?? card?.position,
            pinned: view.positions.has(branch.blockId) || (card?.pinned ?? false),
            collapsed: view.collapsed.has(branch.blockId) || (card?.collapsed ?? false),
            title,
            activeVariantId: view.variants.get(branch.blockId) ?? card?.activeVariantId,
            rows: items.map(item => {
                const row = rowView(item, rowTemplates.get(item.member.id));
                const child = branchesByNode.get(item.member.valueNodeId);
                const childWindows =
                    child?.collectionIds
                        .map(id => windows.get(id))
                        .filter(
                            (window): window is CollectionWindow => window !== undefined
                        ) ?? [];
                const state = childWindows.some(window => window.state === 'loading')
                    ? 'loading'
                    : childWindows.some(window => window.state === 'failed')
                      ? 'failed'
                      : childWindows.some(window => window.state === 'partial')
                        ? 'partial'
                        : childWindows.length
                          ? 'complete'
                          : 'notRequested';
                const branchInfo =
                    row.branch ??
                    (row.expandable
                        ? {
                              totalItems: childWindows.length
                                  ? childWindows.reduce(
                                        (total, window) => total + window.totalItems,
                                        0
                                    )
                                  : item.valueSummary.directMemberCount,
                              state,
                          }
                        : undefined);

                return {
                    ...row,
                    branch: branchInfo,
                    expanded:
                        view.expanded.get(`${branch.blockId}/${row.memberId}`) ??
                        row.expanded,
                };
            }),
            rowWindow: {
                ...card?.rowWindow,
                firstIndex,
                loadedItems,
                firstMemberId: items[0]?.member.id ?? null,
                totalItems,
                state: primary?.state ?? card?.rowWindow.state ?? 'notRequested',
                hasMore: collections.some(collection => collection.nextCursor !== null),
                error: primary?.error,
            },
        });
    }

    const hidden = new Set<string>();

    let changed = true;

    while (changed) {
        changed = false;

        for (const connection of view.connections) {
            if (
                !hidden.has(connection.targetBlockId) &&
                (view.expanded.get(
                    `${connection.sourceBlockId}/${connection.sourceMemberId}`
                ) === false ||
                    hidden.has(connection.sourceBlockId))
            ) {
                hidden.add(connection.targetBlockId);
                changed = true;
            }
        }
    }

    return {
        ...template,
        version,
        state: cards.length ? 'ready' : 'empty',
        cards: cards.filter(card => !hidden.has(card.blockId)),
        selection: view.selection,
        connections: view.connections.filter(
            connection =>
                !hidden.has(connection.sourceBlockId) &&
                !hidden.has(connection.targetBlockId)
        ),
    };
}

export function memberInDocument(
    document: EditorDocument,
    memberId: string
): MemberSummary | undefined {
    for (const window of document.projectedCollections().values()) {
        const row = window.items.find(item => item.member.id === memberId);

        if (row) {
            return row;
        }
    }

    return undefined;
}
