import type { EditorDependencies } from '../app/dependencies';
import type { FixtureData } from '../app/fixture';
import { CachedSchemaRepository } from '../env/cache/cached.schema.repo';
import { FixtureSchemaRepository } from '../env/fixtures/fixture.schema.repo';
import { HttpSchemaRepository } from '../env/repos/http.schema.repo';
import { HttpTransport } from '../env/transport/http.transport';

export function createEditorDependencies(
    apiBaseUrl: string,
    fixture: FixtureData | null
): EditorDependencies {
    if (apiBaseUrl === 'fixture://standalone') {
        if (fixture === null) {
            throw new Error('The explicit demo repository requires fixture data.');
        }

        return {
            repository: new FixtureSchemaRepository(fixture),
            cleanup: () => undefined,
        };
    }

    const repository = new CachedSchemaRepository(
        new HttpSchemaRepository(new HttpTransport(apiBaseUrl))
    );

    return { repository, cleanup: () => repository.clear() };
}
