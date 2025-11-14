import type { MemberCollection } from './contracts';

export function findMember<T extends MemberCollection>(
    windows: ReadonlyMap<string, T>,
    memberId: string
) {
    for (const window of windows.values()) {
        const row = window.items.find(item => item.member.id === memberId);

        if (row) {
            return {
                window,
                row,
            };
        }
    }

    return null;
}
