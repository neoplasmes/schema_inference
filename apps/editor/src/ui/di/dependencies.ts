import type { CreateDraftCommand } from '../../app/commands/create_draft';
import type { SaveSchemaCommand } from '../../app/commands/save_schema';
import type { FixtureData } from '../../app/ports/repos/schema';
import type { LoadBranchQuery } from '../../app/queries/load_branch';
import type { OpenSchemaQuery } from '../../app/queries/open_schema';
import type { ReadSchemaChangeQuery } from '../../app/queries/read_schema_change';
import type { ReadSchemaMembersQuery } from '../../app/queries/read_schema_members';
import type { ReadSchemaNodeQuery } from '../../app/queries/read_schema_node';

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
