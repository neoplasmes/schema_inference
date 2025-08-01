import type { BoardLod, BoardViewport, Point } from '../model';
import type { Rectangle } from '../render/contracts';

export const MIN_ZOOM = 0.12;
export const MAX_ZOOM = 3;

export function screenToWorld(point: Point, viewport: BoardViewport): Point {
    return {
        x: (point.x - viewport.x) / viewport.zoom,
        y: (point.y - viewport.y) / viewport.zoom,
    };
}

export function worldToScreen(point: Point, viewport: BoardViewport): Point {
    return {
        x: point.x * viewport.zoom + viewport.x,
        y: point.y * viewport.zoom + viewport.y,
    };
}

export function normalizeViewport(viewport: BoardViewport): BoardViewport {
    return {
        x: Number.isFinite(viewport.x) ? viewport.x : 0,
        y: Number.isFinite(viewport.y) ? viewport.y : 0,
        zoom: Math.min(
            MAX_ZOOM,
            Math.max(MIN_ZOOM, Number.isFinite(viewport.zoom) ? viewport.zoom : 1)
        ),
    };
}

export function zoomAt(
    viewport: BoardViewport,
    zoom: number,
    anchor: Point
): BoardViewport {
    const world = screenToWorld(anchor, viewport);
    const next = normalizeViewport({ ...viewport, zoom });

    return {
        x: anchor.x - world.x * next.zoom,
        y: anchor.y - world.y * next.zoom,
        zoom: next.zoom,
    };
}

export function fitBounds(
    bounds: Rectangle,
    width: number,
    height: number,
    padding = 64
): BoardViewport {
    const zoom = Math.min(
        1,
        (width - padding * 2) / Math.max(bounds.width, 1),
        (height - padding * 2) / Math.max(bounds.height, 1)
    );
    const normalized = normalizeViewport({ x: 0, y: 0, zoom });

    return {
        x: (width - bounds.width * normalized.zoom) / 2 - bounds.x * normalized.zoom,
        y: (height - bounds.height * normalized.zoom) / 2 - bounds.y * normalized.zoom,
        zoom: normalized.zoom,
    };
}

export function visibleBounds(
    viewport: BoardViewport,
    width: number,
    height: number,
    margin = 120
): Rectangle {
    const topLeft = screenToWorld({ x: -margin, y: -margin }, viewport);

    return {
        ...topLeft,
        width: (width + margin * 2) / viewport.zoom,
        height: (height + margin * 2) / viewport.zoom,
    };
}

export function levelOfDetail(zoom: number): BoardLod {
    if (zoom < 0.35) {
        return 'overview';
    }

    return zoom > 1.2 ? 'detailed' : 'working';
}
