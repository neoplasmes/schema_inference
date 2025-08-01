import type { Rectangle } from '../render/contracts';

export function intersects(a: Rectangle, b: Rectangle): boolean {
    return (
        a.x <= b.x + b.width &&
        a.x + a.width >= b.x &&
        a.y <= b.y + b.height &&
        a.y + a.height >= b.y
    );
}

export function contains(bounds: Rectangle, x: number, y: number): boolean {
    return (
        x >= bounds.x &&
        x <= bounds.x + bounds.width &&
        y >= bounds.y &&
        y <= bounds.y + bounds.height
    );
}

/** A uniform grid bounds each object's index footprint, including very long connections. */
export class SpatialIndex<T extends { bounds: Rectangle }> {
    private readonly entries = new Map<string, T>();
    private readonly columns = new Map<number, Map<number, Set<string>>>();
    private readonly memberships = new Map<
        string,
        readonly (readonly [number, number])[]
    >();
    private readonly spanning = new Set<string>();

    constructor(private readonly cellSize = 512) {}

    set(id: string, item: T): void {
        this.delete(id);
        this.entries.set(id, item);
        const left = Math.floor(item.bounds.x / this.cellSize);
        const top = Math.floor(item.bounds.y / this.cellSize);
        const right = Math.floor((item.bounds.x + item.bounds.width) / this.cellSize);
        const bottom = Math.floor((item.bounds.y + item.bounds.height) / this.cellSize);

        if ((right - left + 1) * (bottom - top + 1) > 64) {
            this.spanning.add(id);

            return;
        }

        const membership: [number, number][] = [];

        for (let x = left; x <= right; x += 1) {
            let column = this.columns.get(x);

            if (!column) {
                column = new Map();
                this.columns.set(x, column);
            }

            for (let y = top; y <= bottom; y += 1) {
                let cell = column.get(y);

                if (!cell) {
                    cell = new Set();
                    column.set(y, cell);
                }

                cell.add(id);
                membership.push([x, y]);
            }
        }

        this.memberships.set(id, membership);
    }

    delete(id: string): void {
        for (const [x, y] of this.memberships.get(id) ?? []) {
            const column = this.columns.get(x);
            const cell = column?.get(y);
            cell?.delete(id);

            if (!cell?.size) {
                column?.delete(y);
            }

            if (!column?.size) {
                this.columns.delete(x);
            }
        }

        this.memberships.delete(id);
        this.spanning.delete(id);
        this.entries.delete(id);
    }

    clear(): void {
        this.entries.clear();
        this.columns.clear();
        this.memberships.clear();
        this.spanning.clear();
    }

    query(bounds: Rectangle): T[] {
        return this.queryInto(bounds, [], new Set());
    }

    queryInto(bounds: Rectangle, result: T[], ids: Set<string>): T[] {
        result.length = 0;
        ids.clear();
        const left = Math.floor(bounds.x / this.cellSize);
        const top = Math.floor(bounds.y / this.cellSize);
        const right = Math.floor((bounds.x + bounds.width) / this.cellSize);
        const bottom = Math.floor((bounds.y + bounds.height) / this.cellSize);

        if ((right - left + 1) * (bottom - top + 1) > 64) {
            for (const item of this.entries.values()) {
                if (intersects(item.bounds, bounds)) {
                    result.push(item);
                }
            }

            return result;
        }

        for (const id of this.spanning) {
            ids.add(id);
        }

        for (let x = left; x <= right; x += 1) {
            const column = this.columns.get(x);

            if (!column) {
                continue;
            }

            for (let y = top; y <= bottom; y += 1) {
                const cell = column.get(y);

                if (cell) {
                    for (const id of cell) {
                        ids.add(id);
                    }
                }
            }
        }

        for (const id of ids) {
            const item = this.entries.get(id);

            if (item && intersects(item.bounds, bounds)) {
                result.push(item);
            }
        }

        return result;
    }
}
