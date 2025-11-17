import { CreateDraftCommand } from '../../app/commands/createDraft';
import { SaveSchemaCommand } from '../../app/commands/saveSchema';
import type { FixtureData } from '../../app/ports/repos/schema';
import { LoadBranchQuery } from '../../app/queries/loadBranch';
import { OpenSchemaQuery } from '../../app/queries/openSchema';
import { ReadSchemaChangeQuery } from '../../app/queries/readSchemaChange';
import { ReadSchemaMembersQuery } from '../../app/queries/readSchemaMembers';
import { ReadSchemaNodeQuery } from '../../app/queries/readSchemaNode';
import { CachedSchemaRepository } from '../../env/cache/schemaPages';
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
