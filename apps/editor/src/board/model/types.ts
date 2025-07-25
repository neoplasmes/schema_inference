export type Point = Readonly<{ x: number; y: number }>;

export type BoardSelection = Readonly<{
    blockId: string;
    memberId: string | null;
}>;

export type CollectionState =
    | 'notRequested'
    | 'loading'
    | 'partial'
    | 'complete'
    | 'failed';

export type BoardRow = Readonly<{
    memberId: string;
    name: string;
    typeLabel: string;
    typeEmphasis?: boolean;
    occurrenceLabel?: string;
    icon: 'element' | 'attribute' | 'group' | 'reference' | 'scalar';
    change: 'unchanged' | 'added' | 'removed';
    expandable: boolean;
    expanded: boolean;
    variantsCount?: number;
    observation?: Readonly<{ count: number; total: number }>;
    suggested?: boolean;
    nameAlias?: string;
    warning?: string;
    branch?: Readonly<{ totalItems: number | null; state: CollectionState }>;
}>;

export type BoardVariant = Readonly<{
    variantId: string;
    scopeId: string;
    title: string;
    count: number;
    total: number;
}>;

export type BoardCard = Readonly<{
    blockId: string;
    nodeId: string;
    collectionId: string | null;
    title: string;
    subtitle?: string;
    subtitleEmphasis?: boolean;
    namespace?: string;
    note?: string;
    display?: 'standard' | 'summary';
    metrics?: Readonly<{
        header?: number;
        row?: number;
        rowLimit?: number;
        boundary?: number;
        footer?: number;
        warning?: number;
        note?: number;
        occurrenceColumn?: boolean;
        rowGlyphs?: boolean;
        separators?: boolean;
        reserveGlyphColumn?: boolean;
    }>;
    position?: Point;
    width?: number;
    pinned: boolean;
    collapsed: boolean;
    suggested: boolean;
    rows: readonly BoardRow[];
    rowWindow: Readonly<{
        firstMemberId: string | null;
        totalItems: number;
        state: CollectionState;
        hasMore: boolean;
        error?: string;
        firstIndex?: number;
        loadedItems?: number;
    }>;
    variants?: readonly BoardVariant[];
    activeVariantId?: string;
}>;

export type BoardConnection = Readonly<{
    id: string;
    sourceBlockId: string;
    sourceMemberId: string;
    targetBlockId: string;
    kind: 'containment' | 'reference' | 'preview';
    state: 'normal' | 'selected' | 'unloaded';
}>;

export type BoardLod = 'overview' | 'working' | 'detailed';

export type BoardModel = Readonly<{
    version: number;
    cards: readonly BoardCard[];
    connections: readonly BoardConnection[];
    selection: BoardSelection | null;
    state: 'ready' | 'loading' | 'empty' | 'failed';
    diagnosticLod?: BoardLod;
}>;

export type BoardViewport = Readonly<{ x: number; y: number; zoom: number }>;

export type BoardEventMap = {
    select: BoardSelection | null;
    hover: BoardSelection | null;
    rename: { blockId: string; memberId: string; name: string };
    move:
        | { kind: 'card'; blockId: string; position: Point }
        | {
              kind: 'member';
              memberId: string;
              sourceBlockId: string;
              targetBlockId: string;
              targetCollectionId: string;
              beforeMemberId: string | null;
          };
    expand: { blockId: string; memberId: string; expanded: boolean };
    variantChange: { blockId: string; variantId: string; scopeId: string };
    viewportChange: BoardViewport;
    loadMore: { blockId: string; collectionId: string };
    add: { blockId: string; collectionId: string };
};

export type BoardEventHandler<K extends keyof BoardEventMap> = (
    payload: BoardEventMap[K]
) => void;
