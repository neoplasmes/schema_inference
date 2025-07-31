import type { DocumentOperation, MemberSummary, SchemaNode } from '../../entities/schema';

export type MemberCollection = Readonly<{
    collectionId: string;
    items: readonly MemberSummary[];
    totalItems: number;
}>;

export type EditableCollection = MemberCollection &
    Readonly<{
        available: boolean;
        complete: boolean;
        contiguous: boolean;
    }>;

export type DocumentEditState = Readonly<{
    nodes: ReadonlyMap<string, SchemaNode>;
    collections: ReadonlyMap<string, EditableCollection>;
}>;

export type DocumentEdit = Readonly<{
    forward: DocumentOperation;
    inverse: DocumentOperation;
}>;
