import type { BoardSelection, BoardViewport, Point } from '../../model';
import type { BoardHit } from '../../render';

export type Gesture = {
    pointerId: number;
    start: Point;
    viewport: BoardViewport;
    hit: BoardHit | null;
    kind: 'pan' | 'card' | 'member' | 'press';
    origin: Point;
    moved: boolean;
    blockedBlocks: ReadonlySet<string> | null;
};

export type Pinch = { viewport: BoardViewport; distance: number; center: Point };

export const DRAG_THRESHOLD = 5;

export function hitSelection(hit: BoardHit | null): BoardSelection | null {
    if (!hit) {
        return null;
    }

    return { blockId: hit.blockId, memberId: 'memberId' in hit ? hit.memberId : null };
}

export function sameSelection(
    left: BoardSelection | null,
    right: BoardSelection | null
): boolean {
    return left?.blockId === right?.blockId && left?.memberId === right?.memberId;
}

export function midpoint(points: readonly Point[]): Point {
    return { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
}

export function distance(points: readonly Point[]): number {
    return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
}

export type GestureState = {
    pointers: Map<number, Point>;
    gesture: Gesture | null;
    pinch: Pinch | null;
    spacePressed: boolean;
};

export function createGestureState(): GestureState {
    return { pointers: new Map(), gesture: null, pinch: null, spacePressed: false };
}

export function localPoint(
    container: HTMLElement,
    event: { clientX: number; clientY: number }
): Point {
    const rect = container.getBoundingClientRect();

    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}
