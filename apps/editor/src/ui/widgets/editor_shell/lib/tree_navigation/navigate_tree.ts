import type { KeyboardEvent } from 'react';

export function navigateTree(event: KeyboardEvent<HTMLElement>): void {
    const items = [
        ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="treeitem"]'),
    ];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = index;

    if (event.key === 'ArrowDown') {
        next = Math.min(items.length - 1, index + 1);
    } else if (event.key === 'ArrowUp') {
        next = Math.max(0, index - 1);
    } else if (event.key === 'Home') {
        next = 0;
    } else if (event.key === 'End') {
        next = items.length - 1;
    } else {
        return;
    }

    event.preventDefault();
    items[next]?.focus();
}
