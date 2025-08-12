import type { EntityRecord, NormalizedValue } from './types';

export function sameValue(left: NormalizedValue, right: NormalizedValue): boolean {
    if (left === right) {
        return true;
    }

    if (left.kind !== right.kind) {
        return false;
    }

    if (left.kind === 'value' && right.kind === 'value') {
        return Object.is(left.value, right.value);
    }

    if (left.kind === 'entity' && right.kind === 'entity') {
        return left.ref === right.ref;
    }

    if (left.kind === 'array' && right.kind === 'array') {
        return (
            left.items.length === right.items.length &&
            left.items.every((item, index) => sameValue(item, right.items[index]))
        );
    }

    return (
        left.kind === 'object' &&
        right.kind === 'object' &&
        sameRecord(left.fields, right.fields)
    );
}

export function sameRecord(left: EntityRecord, right: EntityRecord): boolean {
    const keys = Object.keys(left);

    return (
        keys.length === Object.keys(right).length &&
        keys.every(key => Object.hasOwn(right, key) && sameValue(left[key], right[key]))
    );
}

export function references(value: NormalizedValue): readonly string[] {
    const found = new Set<string>();
    const visit = (item: NormalizedValue): void => {
        if (item.kind === 'entity') {
            found.add(item.ref);
        } else if (item.kind === 'array') {
            item.items.forEach(visit);
        } else if (item.kind === 'object') {
            Object.values(item.fields).forEach(visit);
        }
    };
    visit(value);

    return [
        ...found,
    ];
}

export function recordReferences(record: EntityRecord): readonly string[] {
    return references({
        kind: 'object',
        fields: record,
    });
}
