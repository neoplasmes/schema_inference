/**
 * Присваивает свойства из исходного объекта целевому, пропуская указанные свойства.
 * @param target - Целевой объект, который будет изменен.
 * @param source - Исходный объект, из которого берутся значения.
 * @param skipProperties - Массив ключей свойств исходного объекта, которые нужно пропустить.
 */
export function assignObjectSkippingProperties<
    T extends object,
    S extends object,
    K extends keyof S,
>(target: T, source: S, skipProperties: K[]): T & Omit<S, K> {
    const skipSet = new Set<keyof S>(skipProperties);
    const writableTarget = target as Record<keyof S, unknown>;

    for (const key in source) {
        if (Object.prototype.hasOwnProperty.call(source, key) && !skipSet.has(key)) {
            writableTarget[key] = source[key];
        }
    }

    return target as T & Omit<S, K>;
}
