import type { SchemaRepository } from '../application/ports/repos/schema.repo';
import type { FixtureData } from './fixture';

export type EditorDependencies = Readonly<{
    repository: SchemaRepository;
    cleanup(): void;
}>;

export type EditorDependenciesFactory = (
    fixture: FixtureData | null
) => EditorDependencies;
