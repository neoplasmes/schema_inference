import { CreateDraftCommand } from '../../app/commands/create_draft';
import { SaveSchemaCommand } from '../../app/commands/save_schema';
import type { FixtureData } from '../../app/ports/repos/schema';
import { LoadBranchQuery } from '../../app/queries/load_branch';
import { OpenSchemaQuery } from '../../app/queries/open_schema';
import { ReadSchemaChangeQuery } from '../../app/queries/read_schema_change';
import { ReadSchemaMembersQuery } from '../../app/queries/read_schema_members';
import { ReadSchemaNodeQuery } from '../../app/queries/read_schema_node';
import { CachedSchemaRepository } from '../../env/cache/schema_pages';
import { FixtureSchemaRepository } from '../../env/repos/schema/fixture';
import { HttpSchemaRepository } from '../../env/repos/schema/http';
import { HttpTransport } from '../../env/transport/http';
import { MockHttpTransport, type MockRequest } from '../../env/transport/mock';
import type { EditorDependencies } from '../../ui/di';

export function createEditorDependencies(
    apiBaseUrl: string,
    fixture: FixtureData | null,
    request?: MockRequest
): EditorDependencies {
    if (apiBaseUrl === 'fixture://standalone' && fixture === null) {
        throw new Error('The explicit demo repository requires fixture data.');
    }

    const repository =
        apiBaseUrl === 'fixture://standalone' && fixture !== null
            ? new FixtureSchemaRepository(fixture)
            : new CachedSchemaRepository(
                  new HttpSchemaRepository(
                      request
                          ? new MockHttpTransport(request)
                          : new HttpTransport(apiBaseUrl)
                  )
              );

    return {
        openSchema: new OpenSchemaQuery(repository),
        createDraft: new CreateDraftCommand(repository),
        loadBranch: new LoadBranchQuery(repository),
        readNode: new ReadSchemaNodeQuery(repository),
        readMembers: new ReadSchemaMembersQuery(repository),
        saveSchema: new SaveSchemaCommand(repository),
        readChange: new ReadSchemaChangeQuery(repository),
        cleanup: () => {
            if (repository instanceof CachedSchemaRepository) {
                repository.clear();
            }
        },
    };
}
