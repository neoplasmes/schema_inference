import type { Point } from '../../model';
import { screenToWorld, zoomAt } from '../../viewport';
import type { BoardInteractionOptions } from '../contracts';
import type { RenameController } from '../rename';
import type { SelectionController } from '../controller';
import {
    DRAG_THRESHOLD,
    midpoint,
    distance,
    hitSelection,
    localPoint,
    memberDropAt,
    type GestureState,
    type ViewportController,
} from '../gesture';

export function createPointerController(
    options: BoardInteractionOptions,
    gestures: GestureState,
    selection: SelectionController,
    rename: RenameController,
    viewport: ViewportController,
    previous: { cursor: string }
) {
    const { container, renderer, emit, getModel, getViewport } = options;
    const { setHover, activate } = selection;
    const setViewport = viewport.set;
    const flushWheel = viewport.flush;
    const local = (event: { clientX: number; clientY: number }) =>
        localPoint(container, event);
    const world = (point: Point) => screenToWorld(point, getViewport());
    let disposed = false;

    function release(pointerId: number) {
        if (container.hasPointerCapture?.(pointerId)) {
            container.releasePointerCapture(pointerId);
        }
    }

    function clearPreview() {
        if (gestures.gesture?.kind === 'card' && gestures.gesture.hit) {
            renderer.previewCardPosition(gestures.gesture.hit.blockId, null);
        }

        renderer.setDropTarget(null);
        renderer.previewMemberDrag(null);
        container.style.cursor = previous.cursor;
    }

    function cancel() {
        const active = gestures.gesture;
        const activePinch = gestures.pinch;
        const captured = [...gestures.pointers.keys()];
        clearPreview();
        gestures.gesture = null;
        gestures.pinch = null;
        gestures.pointers.clear();

        if (activePinch || active?.kind === 'pan') {
            setViewport(activePinch?.viewport ?? active!.viewport);
        }

        for (const pointerId of captured) {
            release(pointerId);
        }

        gestures.spacePressed = false;
    }

    function pointerDown(event: PointerEvent) {
        if (
            disposed ||
            (event.target !== container &&
                event.target !== container.querySelector('canvas')) ||
            (event.button !== 0 && event.button !== 1)
        ) {
            return;
        }

        event.preventDefault();
        flushWheel();
        rename.close();
        container.focus({ preventScroll: true });
        container.style.outline = '';
        const point = local(event);
        gestures.pointers.set(event.pointerId, point);
        container.setPointerCapture?.(event.pointerId);

        if (gestures.pointers.size === 2) {
            clearPreview();
            gestures.gesture = null;
            const points = [...gestures.pointers.values()];
            gestures.pinch = {
                viewport: getViewport(),
                center: midpoint(points),
                distance: Math.max(1, distance(points)),
            };

            return;
        }

        if (gestures.pointers.size !== 1) {
            return;
        }

        const hit = renderer.hitTest(world(point));
        const geometry =
            hit?.kind === 'header'
                ? renderer
                      .queryCards({ ...world(point), width: 0.01, height: 0.01 })
                      .find(card => card.blockId === hit.blockId)
                : null;
        const pan = !hit || event.button === 1 || gestures.spacePressed;
        gestures.gesture = {
            pointerId: event.pointerId,
            start: point,
            viewport: getViewport(),
            hit,
            kind: pan
                ? 'pan'
                : hit.kind === 'header'
                  ? 'card'
                  : hit.kind === 'row'
                    ? 'member'
                    : 'press',
            origin: geometry
                ? { x: geometry.bounds.x, y: geometry.bounds.y }
                : world(point),
            moved: false,
            blockedBlocks: null,
        };
    }

    function pointerMove(event: PointerEvent) {
        const point = local(event);

        if (gestures.pointers.has(event.pointerId)) {
            gestures.pointers.set(event.pointerId, point);
        }

        if (gestures.pinch) {
            const points = [...gestures.pointers.values()];

            if (points.length < 2) {
                return;
            }

            const center = midpoint(points);
            const next = zoomAt(
                gestures.pinch.viewport,
                (gestures.pinch.viewport.zoom * distance(points)) /
                    gestures.pinch.distance,
                gestures.pinch.center
            );
            setViewport({
                ...next,
                x: next.x + center.x - gestures.pinch.center.x,
                y: next.y + center.y - gestures.pinch.center.y,
            });

            return;
        }

        if (!gestures.gesture || gestures.gesture.pointerId !== event.pointerId) {
            if (!gestures.pointers.size && event.target !== rename.element()) {
                const hit = renderer.hitTest(world(point));
                setHover(hitSelection(hit));
                container.style.cursor =
                    hit?.kind === 'header' ? 'grab' : hit ? 'pointer' : previous.cursor;
            }

            return;
        }

        const dx = point.x - gestures.gesture.start.x;
        const dy = point.y - gestures.gesture.start.y;
        gestures.gesture.moved ||= Math.hypot(dx, dy) >= DRAG_THRESHOLD;

        if (!gestures.gesture.moved) {
            return;
        }

        setHover(null);

        if (gestures.gesture.kind === 'pan') {
            container.style.cursor = 'grabbing';
            setViewport({
                ...gestures.gesture.viewport,
                x: gestures.gesture.viewport.x + dx,
                y: gestures.gesture.viewport.y + dy,
            });
        } else if (gestures.gesture.kind === 'card' && gestures.gesture.hit) {
            container.style.cursor = 'grabbing';
            renderer.previewCardPosition(gestures.gesture.hit.blockId, {
                x: gestures.gesture.origin.x + dx / gestures.gesture.viewport.zoom,
                y: gestures.gesture.origin.y + dy / gestures.gesture.viewport.zoom,
            });
        } else if (gestures.gesture.kind === 'member') {
            const move = memberDropAt(options, gestures.gesture, world(point));

            if (gestures.gesture.hit?.kind === 'row') {
                renderer.previewMemberDrag({
                    blockId: gestures.gesture.hit.blockId,
                    memberId: gestures.gesture.hit.memberId,
                    position: world(point),
                });
            }

            container.style.cursor = move ? 'grabbing' : 'no-drop';
            renderer.setDropTarget(
                move?.kind === 'member'
                    ? move.beforeMemberId
                        ? {
                              kind: 'row',
                              blockId: move.targetBlockId,
                              memberId: move.beforeMemberId,
                          }
                        : { kind: 'header', blockId: move.targetBlockId }
                    : null
            );
        }
    }

    function pointerUp(event: PointerEvent) {
        if (!gestures.pointers.has(event.pointerId)) {
            return;
        }

        gestures.pointers.delete(event.pointerId);

        if (gestures.pinch) {
            gestures.pinch = null;
            const captured = [...gestures.pointers.keys(), event.pointerId];
            gestures.pointers.clear();

            for (const pointerId of captured) {
                release(pointerId);
            }

            emit('viewportChange', getViewport());

            return;
        }

        const active = gestures.gesture;

        if (!active || active.pointerId !== event.pointerId) {
            release(event.pointerId);

            return;
        }

        const point = local(event);
        const move =
            active.kind === 'member' && active.moved
                ? memberDropAt(options, gestures.gesture, world(point))
                : null;
        clearPreview();
        gestures.gesture = null;
        release(event.pointerId);

        if (active.moved) {
            if (active.kind === 'pan') {
                emit('viewportChange', getViewport());
            } else if (active.kind === 'card' && active.hit) {
                emit('move', {
                    kind: 'card',
                    blockId: active.hit.blockId,
                    position: {
                        x:
                            active.origin.x +
                            (point.x - active.start.x) / active.viewport.zoom,
                        y:
                            active.origin.y +
                            (point.y - active.start.y) / active.viewport.zoom,
                    },
                });
            } else if (move) {
                emit('move', move);
            }
        } else if (event.button === 0 && !gestures.spacePressed) {
            const hit = renderer.hitTest(world(point));

            if (JSON.stringify(hit) === JSON.stringify(active.hit)) {
                activate(hit);
            }
        }
    }

    function pointerCancel(event: PointerEvent) {
        if (gestures.pointers.has(event.pointerId)) {
            cancel();
        }
    }

    function doubleClick(event: MouseEvent) {
        if (event.target === rename.element()) {
            return;
        }

        const hit = renderer.hitTest(world(local(event)));

        if (hit?.kind === 'row') {
            event.preventDefault();
            rename.open(hitSelection(hit));
        }
    }

    function leave() {
        if (!gestures.pointers.size) {
            setHover(null);
        }
    }

    return {
        pointerDown,
        pointerMove,
        pointerUp,
        pointerCancel,
        doubleClick,
        leave,
        cancel,
        modelChanged() {
            if (gestures.gesture) {
                gestures.gesture.blockedBlocks = null;
            }

            if (gestures.gesture?.hit) {
                const hit = gestures.gesture.hit;
                const card = getModel().cards.find(card => card.blockId === hit.blockId);

                if (
                    !card ||
                    ('memberId' in hit &&
                        !card.rows.some(row => row.memberId === hit.memberId))
                ) {
                    cancel();
                }
            }
        },
        destroy() {
            disposed = true;
            cancel();
        },
    };
}

export type PointerController = ReturnType<typeof createPointerController>;
