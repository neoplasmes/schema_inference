import type { BoardModel, BoardSelection } from '../../../../../board';

export type EditorShellProps = {
    model: BoardModel;
    title: string;
    mode: 'evidence' | 'builder';
    presentation?: 'main' | 'comparison';
    demo: boolean;
    busy: boolean;
    saveBlocked?: boolean;
    canUndo: boolean;
    canRedo: boolean;
    pendingChanges: number;
    zoom: number;
    message: string | null;
    onSelect(selection: BoardSelection): void;
    onExpand(blockId: string, memberId: string, expanded: boolean): void;
    onVariant?(blockId: string, variantId: string, scopeId: string): void;
    onPreview?(): void;
    onFit(): void;
    onArrange?(): void;
    onZoom(zoom: number): void;
    onUndo(): void;
    onRedo(): void;
    onSave(): void;
    onExit?(): void;
};
