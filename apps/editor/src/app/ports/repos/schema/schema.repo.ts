import type { ReadOptions } from '../../../contracts';

import type {
    DocumentOperation,
    MemberSummary,
    SchemaDocument,
    SchemaNode,
    Snapshot,
} from '../../../../core/entities/schema';

export type EditorResource =
    | Readonly<{ kind: 'schema'; schemaId: string; revision?: string }>
    | Readonly<{
          kind: 'analysis';
          analysisId: string;
          revision: string;
          rootAlternativeId?: string;
      }>;

export type CreateDraftInput = Extract<EditorResource, { kind: 'analysis' }> &
    Readonly<{ idempotencyKey: string }>;

export type MemberPage = Readonly<{
    snapshot: Snapshot;
    collectionId: string;
    scopeId: null;
    items: readonly MemberSummary[];
    totalItems: number;
    nextCursor: string | null;
}>;

export type ChangeReceipt = Readonly<{
    id: string;
    clientMutationId: string;
    status: 'pending' | 'applied' | 'failed' | 'conflicted';
    revision: string | null;
    error: string | null;
}>;

export interface SchemaRepository {
    open(
        resource: Extract<EditorResource, { kind: 'schema' }>,
        options?: ReadOptions
    ): Promise<SchemaDocument>;
    createFromAnalysis(
        resource: CreateDraftInput
    ): Promise<SchemaDocument>;
    readNode(
        snapshot: Snapshot,
        nodeId: string,
        options?: ReadOptions
    ): Promise<SchemaNode>;
    readMembers(
        snapshot: Snapshot,
        collectionId: string,
        cursor: string | null,
        options?: ReadOptions
    ): Promise<MemberPage>;
    save(
        snapshot: Snapshot,
        mutationId: string,
        operations: readonly DocumentOperation[]
    ): Promise<ChangeReceipt>;
    readChange(
        schemaId: string,
        changeId: string,
        options?: ReadOptions
    ): Promise<ChangeReceipt>;
}

export type FixtureData = Readonly<{
    manifest: SchemaDocument;
    nodes: ReadonlyMap<string, SchemaNode>;
    pages: ReadonlyMap<string, MemberPage>;
}>;
