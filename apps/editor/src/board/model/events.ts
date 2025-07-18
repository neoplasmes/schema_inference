import type { BoardEventHandler, BoardEventMap } from './types';

export function createBoardEvents() {
    const listeners = new Map<keyof BoardEventMap, Set<(payload: never) => void>>();

    return {
        on<K extends keyof BoardEventMap>(
            event: K,
            handler: BoardEventHandler<K>
        ): () => void {
            let set = listeners.get(event);

            if (!set) {
                set = new Set();
                listeners.set(event, set);
            }

            const callback = handler as (payload: never) => void;
            set.add(callback);

            return () => {
                set.delete(callback);
            };
        },
        emit<K extends keyof BoardEventMap>(event: K, payload: BoardEventMap[K]): void {
            for (const handler of [...(listeners.get(event) ?? [])]) {
                handler(payload as never);
            }
        },
        clear(): void {
            for (const set of listeners.values()) {
                set.clear();
            }

            listeners.clear();
        },
    };
}
