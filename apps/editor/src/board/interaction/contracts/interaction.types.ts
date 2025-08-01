import type { BoardEventMap, BoardModel, BoardViewport } from '../../model';
import type { BoardRenderer } from '../../render';
import type { ResolvedBoardTheme } from '../../theme';

export type BoardInteractionOptions = {
    container: HTMLElement;
    renderer: BoardRenderer;
    getModel: () => BoardModel;
    getViewport: () => BoardViewport;
    setViewport: (viewport: BoardViewport) => void;
    emit: <K extends keyof BoardEventMap>(type: K, payload: BoardEventMap[K]) => void;
    theme?: ResolvedBoardTheme;
};
