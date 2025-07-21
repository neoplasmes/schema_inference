import type {
    BoardEventMap,
    BoardModel,
    BoardSelection,
    BoardViewport,
    Point,
} from '../model/types';
import type { BoardHit, BoardRenderer } from '../render/types';
import { resolveTheme, type ResolvedBoardTheme } from '../render/theme';
import {
    normalizeViewport,
    screenToWorld,
    worldToScreen,
    zoomAt,
} from '../viewport/coordinates';
import { createRenameInput } from './rename_input';

export type BoardInteractionOptions = {
    container: HTMLElement;
    renderer: BoardRenderer;
    getModel: () => BoardModel;
    getViewport: () => BoardViewport;
    setViewport: (viewport: BoardViewport) => void;
    emit: <K extends keyof BoardEventMap>(type: K, payload: BoardEventMap[K]) => void;
    theme?: ResolvedBoardTheme;
};

type Gesture = {
    pointerId: number;
    start: Point;
    viewport: BoardViewport;
    hit: BoardHit | null;
    kind: 'pan' | 'card' | 'member' | 'press';
    origin: Point;
    moved: boolean;
    blockedBlocks: ReadonlySet<string> | null;
};

type Pinch = { viewport: BoardViewport; distance: number; center: Point };

const DRAG_THRESHOLD = 5;

function hitSelection(hit: BoardHit | null): BoardSelection | null {
    if (!hit) {
        return null;
    }

    return { blockId: hit.blockId, memberId: 'memberId' in hit ? hit.memberId : null };
}

function sameSelection(
    left: BoardSelection | null,
    right: BoardSelection | null
): boolean {
    return left?.blockId === right?.blockId && left?.memberId === right?.memberId;
}

function midpoint(points: readonly Point[]): Point {
    return { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
}

function distance(points: readonly Point[]): number {
    return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
}

export function createBoardInteraction(options: BoardInteractionOptions) {
    const { container, renderer, emit, getModel, getViewport } = options;
    const theme = options.theme ?? resolveTheme();
    const view = container.ownerDocument.defaultView;
    const pointers = new Map<number, Point>();
    const previous = {
        tabIndex: container.getAttribute('tabindex'),
        touchAction: container.style.touchAction,
        outline: container.style.outline,
        outlineOffset: container.style.outlineOffset,
        cursor: container.style.cursor,
    };
    let gesture: Gesture | null = null;
    let pinch: Pinch | null = null;
    let hover: BoardSelection | null = null;
    let selection = getModel().selection;
    let input: ReturnType<typeof createRenameInput> | null = null;
    let spacePressed = false;
    let disposed = false;
    let wheelTimer: ReturnType<typeof setTimeout> | null = null;
    let wheelPending = false;

    container.tabIndex = 0;
    container.style.touchAction = 'none';

    function local(event: { clientX: number; clientY: number }): Point {
        const rect = container.getBoundingClientRect();

        return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    function world(point: Point): Point {
        return screenToWorld(point, getViewport());
    }

    function setViewport(viewport: BoardViewport) {
        options.setViewport(normalizeViewport(viewport));
        input?.reposition();
    }

    function select(next: BoardSelection | null) {
        selection = next;
        emit('select', next);
    }

    function setHover(next: BoardSelection | null) {
        if (sameSelection(hover, next)) {
            return;
        }

        hover = next;
        renderer.setHover(next);
        emit('hover', next);
    }

    function release(pointerId: number) {
        if (container.hasPointerCapture?.(pointerId)) {
            container.releasePointerCapture(pointerId);
        }
    }

    function clearPreview() {
        if (gesture?.kind === 'card' && gesture.hit) {
            renderer.previewCardPosition(gesture.hit.blockId, null);
        }

        renderer.setDropTarget(null);
        renderer.previewMemberDrag(null);
        container.style.cursor = previous.cursor;
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

    function cancel() {
        const active = gesture;
        const activePinch = pinch;
        const captured = [...pointers.keys()];
        clearPreview();
        gesture = null;
        pinch = null;
        pointers.clear();

        if (activePinch || active?.kind === 'pan') {
            setViewport(activePinch?.viewport ?? active!.viewport);
        }

        for (const pointerId of captured) {
            release(pointerId);
        }

        spacePressed = false;
    }

    function startRename(target: BoardSelection | null) {
        if (!target?.memberId) {
            return;
        }

        const card = getModel().cards.find(card => card.blockId === target.blockId);
        const row = card?.rows.find(row => row.memberId === target.memberId);

        if (!row || row.change === 'removed') {
            return;
        }

        renderer.revealMember(target.blockId, target.memberId);
        input?.destroy();
        const memberId = target.memberId;
        input = createRenameInput({
            theme,
            container,
            selection: { blockId: target.blockId, memberId },
            name: row.name,
            geometry: () => renderer.getGeometry(),
            viewport: getViewport,
            confirm: name => emit('rename', { blockId: target.blockId, memberId, name }),
            closed: () => {
                input = null;
            },
        });
    }

    function activate(hit: BoardHit | null) {
        if (!hit) {
            select(null);

            return;
        }

        select(hitSelection(hit));

        if (hit.kind === 'boundary') {
            renderer.revealMember(hit.blockId, hit.memberId);
            input?.reposition();
        } else if (hit.kind === 'expand') {
            const row = getModel()
                .cards.find(card => card.blockId === hit.blockId)
                ?.rows.find(row => row.memberId === hit.memberId);

            if (row?.expandable) {
                emit('expand', {
                    blockId: hit.blockId,
                    memberId: hit.memberId,
                    expanded: !row.expanded,
                });
            }
        } else if (hit.kind === 'variant') {
            emit('variantChange', {
                blockId: hit.blockId,
                variantId: hit.variantId,
                scopeId: hit.scopeId,
            });
        } else if (hit.kind === 'add') {
            emit('add', { blockId: hit.blockId, collectionId: hit.collectionId });
        } else if (hit.kind === 'more') {
            const card = getModel().cards.find(card => card.blockId === hit.blockId);

            if (
                card &&
                card.rowWindow.state !== 'loading' &&
                (card.rowWindow.hasMore ||
                    card.rowWindow.state === 'failed' ||
                    card.rowWindow.state === 'notRequested')
            ) {
                emit('loadMore', {
                    blockId: hit.blockId,
                    collectionId: hit.collectionId,
                });
            }
        }
    }

    function dropAt(point: Point): BoardEventMap['move'] | null {
        const source = gesture?.hit;

        if (source?.kind !== 'row') {
            return null;
        }

        const model = getModel();
        const sourceCard = model.cards.find(card => card.blockId === source.blockId);
        const sourceRow = sourceCard?.rows.find(row => row.memberId === source.memberId);
        const hit = renderer.hitTest(point);
        const targetGeometry = renderer
            .queryCards({ ...point, width: 0.01, height: 0.01 })
            .find(card => !hit || card.blockId === hit.blockId);
        const target = model.cards.find(card => card.blockId === targetGeometry?.blockId);

        if (
            !sourceRow ||
            sourceRow.change === 'removed' ||
            !target?.collectionId ||
            target.collapsed ||
            (target.rowWindow.state !== 'complete' &&
                target.rowWindow.state !== 'partial')
        ) {
            return null;
        }

        if (
            target.blockId !== source.blockId &&
            target.rows.some(
                row => (row.icon === 'attribute') !== (sourceRow.icon === 'attribute')
            )
        ) {
            return null;
        }

        if (!gesture!.blockedBlocks) {
            const children = new Map<string, string[]>();
            const descendants = new Set<string>();

            for (const connection of model.connections) {
                const targets = children.get(connection.sourceBlockId) ?? [];
                targets.push(connection.targetBlockId);
                children.set(connection.sourceBlockId, targets);

                if (
                    connection.sourceBlockId === source.blockId &&
                    connection.sourceMemberId === source.memberId
                ) {
                    descendants.add(connection.targetBlockId);
                }
            }

            for (const blockId of descendants) {
                for (const targetId of children.get(blockId) ?? []) {
                    descendants.add(targetId);
                }
            }

            gesture!.blockedBlocks = descendants;
        }

        if (gesture!.blockedBlocks.has(target.blockId)) {
            return null;
        }

        const rows = targetGeometry?.rows ?? [];
        const before =
            rows.find(row => point.y < row.bounds.y + row.bounds.height / 2)?.memberId ??
            null;

        if (target.blockId === source.blockId) {
            const index = sourceCard!.rows.findIndex(
                row => row.memberId === source.memberId
            );
            const next = sourceCard!.rows[index + 1]?.memberId ?? null;

            if (before === source.memberId || before === next) {
                return null;
            }
        }

        if (before === null && target.rowWindow.hasMore) {
            return null;
        }

        return {
            kind: 'member',
            memberId: source.memberId,
            sourceBlockId: source.blockId,
            targetBlockId: target.blockId,
            targetCollectionId: target.collectionId,
            beforeMemberId: before,
        };
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
        input?.destroy();
        container.focus({ preventScroll: true });
        container.style.outline = '';
        const point = local(event);
        pointers.set(event.pointerId, point);
        container.setPointerCapture?.(event.pointerId);

        if (pointers.size === 2) {
            clearPreview();
            gesture = null;
            const points = [...pointers.values()];
            pinch = {
                viewport: getViewport(),
                center: midpoint(points),
                distance: Math.max(1, distance(points)),
            };

            return;
        }

        if (pointers.size !== 1) {
            return;
        }

        const hit = renderer.hitTest(world(point));
        const geometry =
            hit?.kind === 'header'
                ? renderer
                      .queryCards({ ...world(point), width: 0.01, height: 0.01 })
                      .find(card => card.blockId === hit.blockId)
                : null;
        const pan = !hit || event.button === 1 || spacePressed;
        gesture = {
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

        if (pointers.has(event.pointerId)) {
            pointers.set(event.pointerId, point);
        }

        if (pinch) {
            const points = [...pointers.values()];

            if (points.length < 2) {
                return;
            }

            const center = midpoint(points);
            const next = zoomAt(
                pinch.viewport,
                (pinch.viewport.zoom * distance(points)) / pinch.distance,
                pinch.center
            );
            setViewport({
                ...next,
                x: next.x + center.x - pinch.center.x,
                y: next.y + center.y - pinch.center.y,
            });

            return;
        }

        if (!gesture || gesture.pointerId !== event.pointerId) {
            if (!pointers.size && event.target !== inputElement()) {
                const hit = renderer.hitTest(world(point));
                setHover(hitSelection(hit));
                container.style.cursor =
                    hit?.kind === 'header' ? 'grab' : hit ? 'pointer' : previous.cursor;
            }

            return;
        }

        const dx = point.x - gesture.start.x;
        const dy = point.y - gesture.start.y;
        gesture.moved ||= Math.hypot(dx, dy) >= DRAG_THRESHOLD;

        if (!gesture.moved) {
            return;
        }

        setHover(null);

        if (gesture.kind === 'pan') {
            container.style.cursor = 'grabbing';
            setViewport({
                ...gesture.viewport,
                x: gesture.viewport.x + dx,
                y: gesture.viewport.y + dy,
            });
        } else if (gesture.kind === 'card' && gesture.hit) {
            container.style.cursor = 'grabbing';
            renderer.previewCardPosition(gesture.hit.blockId, {
                x: gesture.origin.x + dx / gesture.viewport.zoom,
                y: gesture.origin.y + dy / gesture.viewport.zoom,
            });
        } else if (gesture.kind === 'member') {
            const move = dropAt(world(point));

            if (gesture.hit?.kind === 'row') {
                renderer.previewMemberDrag({
                    blockId: gesture.hit.blockId,
                    memberId: gesture.hit.memberId,
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
        if (!pointers.has(event.pointerId)) {
            return;
        }

        pointers.delete(event.pointerId);

        if (pinch) {
            pinch = null;
            const captured = [...pointers.keys(), event.pointerId];
            pointers.clear();

            for (const pointerId of captured) {
                release(pointerId);
            }

            emit('viewportChange', getViewport());

            return;
        }

        const active = gesture;

        if (!active || active.pointerId !== event.pointerId) {
            release(event.pointerId);

            return;
        }

        const point = local(event);
        const move =
            active.kind === 'member' && active.moved ? dropAt(world(point)) : null;
        clearPreview();
        gesture = null;
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
        } else if (event.button === 0 && !spacePressed) {
            const hit = renderer.hitTest(world(point));

            if (JSON.stringify(hit) === JSON.stringify(active.hit)) {
                activate(hit);
            }
        }
    }

    function pointerCancel(event: PointerEvent) {
        if (pointers.has(event.pointerId)) {
            cancel();
        }
    }

    function inputElement() {
        return container.querySelector('[data-board-rename]');
    }

    function wheel(event: WheelEvent) {
        if (event.target === inputElement()) {
            return;
        }

        event.preventDefault();

        if (pointers.size) {
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
                .queryCards({ ...point, width: 0, height: 0 })
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
                input?.reposition();

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

    function ensureVisible(target: BoardSelection) {
        if (target.memberId) {
            renderer.revealMember(target.blockId, target.memberId);
        }

        const card = renderer
            .getGeometry()
            .cards.find(card => card.blockId === target.blockId);
        const bounds = target.memberId
            ? card?.rows.find(row => row.memberId === target.memberId)?.bounds
            : card?.header;

        if (!bounds) {
            return;
        }

        const viewport = getViewport();
        const point = worldToScreen(bounds, viewport);
        const right = point.x + bounds.width * viewport.zoom;
        const bottom = point.y + bounds.height * viewport.zoom;
        const dx =
            point.x < 12
                ? 12 - point.x
                : right > container.clientWidth - 12
                  ? container.clientWidth - 12 - right
                  : 0;
        const dy =
            point.y < 12
                ? 12 - point.y
                : bottom > container.clientHeight - 12
                  ? container.clientHeight - 12 - bottom
                  : 0;

        if (dx || dy) {
            setViewport({ ...viewport, x: viewport.x + dx, y: viewport.y + dy });
            emit('viewportChange', getViewport());
        }
    }

    function keyDown(event: KeyboardEvent) {
        if (
            event.target !== container ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.isComposing
        ) {
            return;
        }

        if (event.key === 'Escape') {
            event.preventDefault();
            cancel();
            setHover(null);

            return;
        }

        if (event.key === ' ') {
            event.preventDefault();
            spacePressed = true;

            return;
        }

        if (pointers.size) {
            return;
        }

        const keys = [
            'Tab',
            'ArrowUp',
            'ArrowDown',
            'ArrowLeft',
            'ArrowRight',
            'Home',
            'End',
            'Enter',
            'F2',
        ];

        if (!keys.includes(event.key)) {
            return;
        }

        container.style.outline = `2px solid ${theme.color.accent}`;
        container.style.outlineOffset = '-2px';
        const model = getModel();
        const card = model.cards.find(card => card.blockId === selection?.blockId);
        const row = card?.rows.find(row => row.memberId === selection?.memberId);

        if (event.key === 'F2' || (event.key === 'Enter' && row && !row.expandable)) {
            event.preventDefault();
            startRename(selection);

            return;
        }

        if (
            row?.expandable &&
            (event.key === 'Enter' ||
                event.key === 'ArrowLeft' ||
                event.key === 'ArrowRight')
        ) {
            event.preventDefault();
            const expanded =
                event.key === 'Enter' ? !row.expanded : event.key === 'ArrowRight';

            if (expanded !== row.expanded) {
                emit('expand', {
                    blockId: card!.blockId,
                    memberId: row.memberId,
                    expanded,
                });
            }

            return;
        }

        const visibleCards = new Set(
            renderer.getGeometry().cards.map(card => card.blockId)
        );
        const targets = model.cards
            .filter(card => visibleCards.has(card.blockId))
            .flatMap(card => [
                { blockId: card.blockId, memberId: null } as BoardSelection,
                ...(card.collapsed ? [] : card.rows).map(row => ({
                    blockId: card.blockId,
                    memberId: row.memberId,
                })),
            ]);
        const index = targets.findIndex(target => sameSelection(selection, target));
        const backwards =
            event.key === 'ArrowUp' ||
            event.key === 'ArrowLeft' ||
            (event.key === 'Tab' && event.shiftKey);
        let next = index + (backwards ? -1 : 1);

        if (event.key === 'Home') {
            next = 0;
        } else if (event.key === 'End') {
            next = targets.length - 1;
        } else if (event.key === 'Enter') {
            next = Math.min(index + 1, targets.length - 1);
        } else if (index < 0) {
            next = backwards ? targets.length - 1 : 0;
        }

        if (event.key === 'Tab' && (next < 0 || next >= targets.length)) {
            return;
        }

        event.preventDefault();
        const target = targets[Math.min(targets.length - 1, Math.max(0, next))];

        if (target) {
            select(target);
            ensureVisible(target);
        }
    }

    function keyUp(event: KeyboardEvent) {
        if (event.key === ' ') {
            spacePressed = false;
        }
    }

    function doubleClick(event: MouseEvent) {
        if (event.target === inputElement()) {
            return;
        }

        const hit = renderer.hitTest(world(local(event)));

        if (hit?.kind === 'row') {
            event.preventDefault();
            startRename(hitSelection(hit));
        }
    }

    function leave() {
        if (!pointers.size) {
            setHover(null);
        }
    }

    function blur() {
        cancel();
        flushWheel();
        input?.destroy();
        setHover(null);
        container.style.outline = previous.outline;
    }

    function focusOut(event: FocusEvent) {
        if (!event.relatedTarget || !container.contains(event.relatedTarget as Node)) {
            blur();
        }
    }

    function focus() {
        container.style.outline = `2px solid ${theme.color.accent}`;
        container.style.outlineOffset = '-2px';
    }

    container.addEventListener('pointerdown', pointerDown);
    container.addEventListener('pointermove', pointerMove);
    container.addEventListener('pointerup', pointerUp);
    container.addEventListener('pointercancel', pointerCancel);
    container.addEventListener('lostpointercapture', pointerCancel);
    container.addEventListener('pointerleave', leave);
    container.addEventListener('wheel', wheel, { passive: false });
    container.addEventListener('keydown', keyDown);
    container.addEventListener('keyup', keyUp);
    container.addEventListener('dblclick', doubleClick);
    container.addEventListener('focus', focus);
    container.addEventListener('focusout', focusOut);
    view?.addEventListener('blur', blur);

    return {
        modelChanged() {
            if (gesture) {
                gesture.blockedBlocks = null;
            }

            selection = getModel().selection;
            input?.reposition();

            if (gesture?.hit) {
                const hit = gesture.hit;
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
        viewportChanged() {
            input?.reposition();
        },
        destroy() {
            if (disposed) {
                return;
            }

            disposed = true;
            cancel();
            input?.destroy();
            input = null;

            if (wheelTimer !== null) {
                clearTimeout(wheelTimer);
                wheelTimer = null;
            }

            wheelPending = false;
            container.removeEventListener('pointerdown', pointerDown);
            container.removeEventListener('pointermove', pointerMove);
            container.removeEventListener('pointerup', pointerUp);
            container.removeEventListener('pointercancel', pointerCancel);
            container.removeEventListener('lostpointercapture', pointerCancel);
            container.removeEventListener('pointerleave', leave);
            container.removeEventListener('wheel', wheel);
            container.removeEventListener('keydown', keyDown);
            container.removeEventListener('keyup', keyUp);
            container.removeEventListener('dblclick', doubleClick);
            container.removeEventListener('focus', focus);
            container.removeEventListener('focusout', focusOut);
            view?.removeEventListener('blur', blur);

            if (previous.tabIndex === null) {
                container.removeAttribute('tabindex');
            } else {
                container.setAttribute('tabindex', previous.tabIndex);
            }

            container.style.touchAction = previous.touchAction;
            container.style.outline = previous.outline;
            container.style.outlineOffset = previous.outlineOffset;
            container.style.cursor = previous.cursor;
        },
    };
}
