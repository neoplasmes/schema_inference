export function showSeparator(
    index: number,
    count: number,
    highlighted: ReadonlySet<number>
): boolean {
    return (
        count > 4 &&
        index < count - 1 &&
        !highlighted.has(index) &&
        !highlighted.has(index + 1)
    );
}
