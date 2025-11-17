import type { DocumentOperation } from '../../entities/schema';
import type { MemberCollection } from './contracts';
import { findMember } from './members';

export function projectCollections<T extends MemberCollection>(
    collections: ReadonlyMap<string, T>,
    operations: readonly DocumentOperation[]
): ReadonlyMap<string, T> {
    const projected = new Map(collections);

    for (const operation of operations) {
        applyOperation(projected, operation);
    }

    return projected;
}

function applyOperation<T extends MemberCollection>(
    windows: Map<string, T>,
    operation: DocumentOperation
): void {
    if (operation.kind === 'moveMember') {
        const found = findMember(windows, operation.memberId);
        const target = windows.get(operation.targetCollectionId);

        if (!found || !target) {
            return;
        }

        const sameCollection = found.window.collectionId === target.collectionId;
        windows.set(found.window.collectionId, {
            ...found.window,
            items: found.window.items.filter(row => row.member.id !== operation.memberId),
            totalItems: found.window.totalItems - (sameCollection ? 0 : 1),
        });
        const items = [
            ...(windows.get(target.collectionId)?.items ?? []),
        ];
        const index =
            operation.beforeMemberId === null
                ? items.length
                : items.findIndex(row => row.member.id === operation.beforeMemberId);

        items.splice(index < 0 ? items.length : index, 0, found.row);
        windows.set(target.collectionId, {
            ...target,
            items,
            totalItems: target.totalItems + (sameCollection ? 0 : 1),
        });

        return;
    }

    for (const [id, window] of windows) {
        const items = window.items.map(row => {
            if (
                operation.kind === 'renameProperty' &&
                row.member.id === operation.memberId &&
                row.member.kind === 'property'
            ) {
                return {
                    ...row,
                    member: {
                        ...row.member,
                        name: operation.name,
                    },
                };
            }

            if (operation.kind === 'renameXmlName') {
                if (
                    operation.target.kind === 'member' &&
                    row.member.id === operation.target.id &&
                    row.member.kind === 'xmlAttribute'
                ) {
                    return {
                        ...row,
                        member: {
                            ...row.member,
                            name: operation.name,
                        },
                    };
                }

                if (
                    operation.target.kind === 'node' &&
                    row.valueSummary.id === operation.target.id
                ) {
                    return {
                        ...row,
                        valueSummary: {
                            ...row.valueSummary,
                            label: operation.name.localName,
                        },
                    };
                }
            }

            return row;
        });

        windows.set(id, {
            ...window,
            items,
        });
    }
}
