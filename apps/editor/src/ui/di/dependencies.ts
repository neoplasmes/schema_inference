import type { CreateDraftCommand } from '../../app/commands/createDraft';
import type { SaveSchemaCommand } from '../../app/commands/saveSchema';
import type { FixtureData } from '../../app/ports/repos/schema';
import type { LoadBranchQuery } from '../../app/queries/loadBranch';
import type { OpenSchemaQuery } from '../../app/queries/openSchema';
import type { ReadSchemaChangeQuery } from '../../app/queries/readSchemaChange';
import type { ReadSchemaMembersQuery } from '../../app/queries/readSchemaMembers';
import type { ReadSchemaNodeQuery } from '../../app/queries/readSchemaNode';

export type EditorDependencies = Readonly<{
    openSchema: Pick<OpenSchemaQuery, 'execute'>;
    createDraft: Pick<CreateDraftCommand, 'execute'>;
    loadBranch: Pick<LoadBranchQuery, 'execute'>;
    readNode: Pick<ReadSchemaNodeQuery, 'execute'>;
    readMembers: Pick<ReadSchemaMembersQuery, 'execute'>;
    saveSchema: Pick<SaveSchemaCommand, 'execute'>;
    readChange: Pick<ReadSchemaChangeQuery, 'execute'>;
    cleanup(): void;
}>;

export type EditorDependenciesFactory = (
    fixture: FixtureData | null
) => EditorDependencies;
