import type { BoardViewport, Point } from '../../model';
import { normalizeViewport, screenToWorld, zoomAt } from '../../viewport';
import type { BoardInteractionOptions } from '../contracts';
import type { RenameController } from '../rename';
import { localPoint, type GestureState } from './gestureState';

export function createViewportController(
    options: BoardInteractionOptions,
    rename: RenameController,
    gestures: GestureState
) {
    const { container, renderer, emit, getViewport } = options;
    let wheelTimer: ReturnType<typeof setTimeout> | null = null;
    let wheelPending = false;
    const local = (event: { clientX: number; clientY: number }) =>
        localPoint(container, event);
    const world = (point: Point) => screenToWorld(point, getViewport());

    function setViewport(viewport: BoardViewport) {
        options.setViewport(normalizeViewport(viewport));
        rename.reposition();
    }

    function flushWheel() {
        if (wheelTimer !== null) {
            clearTimeout(wheelTimer);
            wheelTimer = null;
        }

        if (wheelPending) {
            wheelPending = false;
            emit('viewportChange', getViewport());
        }
    }

    function wheel(event: WheelEvent) {
        if (event.target === rename.element()) {
            return;
        }

        event.preventDefault();

        if (gestures.pointers.size) {
            return;
        }

        const viewport = getViewport();
        const unit =
            event.deltaMode === 1
                ? 16
                : event.deltaMode === 2
                  ? container.clientHeight
                  : 1;

        if (event.ctrlKey || event.metaKey) {
            setViewport(
                zoomAt(
                    viewport,
                    viewport.zoom * Math.exp(-event.deltaY * unit * 0.01),
                    local(event)
                )
            );
        } else {
            const point = world(local(event));
            const card = renderer
                .queryCards({
                    ...point,
                    width: 0,
                    height: 0,
                })
                .find(card => {
                    const rows = card.rowViewport?.bounds;

                    return (
                        rows &&
                        point.x >= rows.x &&
                        point.x <= rows.x + rows.width &&
                        point.y >= rows.y &&
                        point.y <= rows.y + rows.height
                    );
                });

            if (
                card &&
                event.deltaY !== 0 &&
                renderer.scrollRows(card.blockId, (event.deltaY * unit) / viewport.zoom)
            ) {
                rename.reposition();

                return;
            }

            setViewport({
                ...viewport,
                x: viewport.x - event.deltaX * unit,
                y: viewport.y - event.deltaY * unit,
            });
        }

        wheelPending = true;

        if (wheelTimer !== null) {
            clearTimeout(wheelTimer);
        }

        wheelTimer = setTimeout(flushWheel, 120);
    }

    return {
        set: setViewport,
        wheel,
        flush: flushWheel,
        destroy() {
            if (wheelTimer !== null) {
                clearTimeout(wheelTimer);
                wheelTimer = null;
            }

            wheelPending = false;
        },
    };
}

export type ViewportController = ReturnType<typeof createViewportController>;
