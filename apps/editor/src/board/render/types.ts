import type {
    BoardLod,
    BoardModel,
    BoardSelection,
    BoardViewport,
    CollectionState,
    Point,
} from '../model/types';
import type { BoardTheme } from './theme';

export type { BoardViewport } from '../model/types';

export type Rectangle = Readonly<{ x: number; y: number; width: number; height: number }>;

export type BoardHit =
    | { kind: 'header'; blockId: string }
    | { kind: 'row'; blockId: string; memberId: string }
    | { kind: 'expand'; blockId: string; memberId: string }
    | { kind: 'variant'; blockId: string; variantId: string; scopeId: string }
    | { kind: 'boundary'; blockId: string; memberId: string }
    | { kind: 'more'; blockId: string; collectionId: string }
    | { kind: 'add'; blockId: string; collectionId: string };

export type BoardHitRegion = Readonly<{ bounds: Rectangle; target: BoardHit }>;

export type BoardCardGeometry = Readonly<{
    blockId: string;
    bounds: Rectangle;
    header: Rectangle;
    rows: readonly Readonly<{ memberId: string; bounds: Rectangle }>[];
    regions: readonly BoardHitRegion[];
    visibilityBounds?: Rectangle;
    rowViewport?: Readonly<{
        firstIndex: number;
        endIndex: number;
        totalItems: number;
        bounds: Rectangle;
    }>;
    branches?: readonly Readonly<{
        memberId: string;
        bounds: Rectangle;
        totalItems: number | null;
        state: CollectionState;
    }>[];
}>;

export type BoardConnectionGeometry = Readonly<{
    id: string;
    bounds: Rectangle;
    source: Point;
    target: Point;
    sourceHidden: boolean;
}>;

export type BoardGeometry = Readonly<{
    version: number;
    cards: readonly BoardCardGeometry[];
    connections: readonly BoardConnectionGeometry[];
    bounds: Rectangle;
}>;

export type BoardRenderStats = Readonly<{
    renderedFrames: number;
    visibleCards: number;
    visibleConnections: number;
    textObjects: number;
    lod: BoardLod;
    edgeGraphics?: number;
    edgeLayerRedraws?: number;
}>;

export type BoardRenderer = {
    readonly ready: Promise<void>;
    setModel(model: BoardModel): void;
    setHover(selection: BoardSelection | null): void;
    setViewport(viewport: BoardViewport): void;
    resize(width: number, height: number): void;
    getGeometry(): BoardGeometry;
    hitTest(worldPoint: Point): BoardHit | null;
    queryCards(bounds: Rectangle): readonly BoardCardGeometry[];
    previewCardPosition(blockId: string, position: Point | null): void;
    scrollRows(blockId: string, delta: number): boolean;
    revealMember(blockId: string, memberId: string): boolean;
    previewMemberDrag(
        preview: Readonly<{ blockId: string; memberId: string; position: Point }> | null
    ): void;
    setDropTarget(target: BoardHit | null): void;
    getStats(): BoardRenderStats;
    invalidate(): void;
    destroy(): void;
};

export type BoardRendererOptions = Readonly<{
    container: HTMLElement;
    width?: number;
    height?: number;
    resolution?: number;
    theme?: Partial<BoardTheme>;
    background?: boolean;
}>;
