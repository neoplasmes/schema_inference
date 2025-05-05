/**
 * Присваивает свойства из исходного объекта целевому, пропуская указанные свойства.
 * @param target - Целевой объект, который будет изменен.
 * @param source - Исходный объект, из которого берутся значения.
 * @param skipProperties - Массив ключей свойств исходного объекта, которые нужно пропустить.
 */
export function assignObjectSkippingProperties<
    T extends Record<string, any>,
    S extends Record<string, any>,
    K extends keyof S
>(target: T, source: S, skipProperties: K[]): T & Pick<S, Exclude<keyof S, K>> {
    // Преобразуем skipProperties в Set для быстрого поиска
    const skipSet = new Set(skipProperties);

    // Перебираем все перечислимые свойства исходного объекта
    for (const key in source) {
        //@ts-ignore
        if (Object.prototype.hasOwnProperty.call(source, key) && !skipSet.has(key)) {
            // Присваиваем значение свойства целевому объекту
            (target as any)[key] = source[key];
        }
    }

    // Возвращаем target с уточненным типом
    return target as T & Pick<S, Exclude<keyof S, K>>;
}
