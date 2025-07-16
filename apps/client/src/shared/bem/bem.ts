export const bem = (block: string) => {
    return (element?: string, modifiers: Record<string, boolean> = {}): string => {
        const base = element ? `${block}__${element}` : block;

        const mods = Object.entries(modifiers)
            .filter(([, value]) => value)
            .map(([key]) => `${base}_${key}`);

        return [base, ...mods].join(' ');
    };
};
