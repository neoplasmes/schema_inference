export type ReactiveListener<T> = (value: T) => void;

export type UpdateType<T> = T extends Record<string, unknown> ? Partial<T> : T;

export interface Reactive<T> {
    /**
     * функция для обновления данных
     * @param newData новые данные
     */
    update(newData: UpdateType<T>): void;
    /**
     *
     * @param listener функция которая будет вызвана при изменении каких либо данных
     * @returns функцию unsubscribe
     */
    subscribe(listener: ReactiveListener<T>): () => void;
    /**
     * Функция для получения данных.
     * Просто отдаёт данные объекта, без возможности подписаться на них и без возможности их изменить
     */
    getInternalData(): Readonly<T>;
}

/**
 * @exerimental
 */
export class ReactiveListenersTemplate<T> {
    private listeners: Set<ReactiveListener<T>>;

    constructor() {
        this.listeners = new Set();
    }

    subscribe(listener: ReactiveListener<T>): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    protected notify(notificationData: T): void {
        this.listeners.forEach(listener => listener(notificationData));
    }
}
