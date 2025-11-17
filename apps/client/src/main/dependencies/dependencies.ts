import { CreateAnalysis } from '../../app/commands/createAnalysis';
import { RecordSchemaSaved } from '../../app/commands/recordSchemaSaved';
import { GetAnalysis } from '../../app/queries/getAnalysis';
import { GetSchema } from '../../app/queries/getSchema';
import { ListSchemas } from '../../app/queries/listSchemas';
import { TransportAnalysisRepo } from '../../env/repos/analysis';
import { TransportSchemaRepo } from '../../env/repos/schema';
import { FetchHttpTransport, MockHttpTransport } from '../../env/transport';
import type { Dependencies } from '../../ui/di';
import { createMockEditorBackend } from '../mockEditor';
import { MockWorkspaceBackend } from '../mockWorkspace';
import { loadEditor } from '../editorLoader';
import type { RuntimeConfiguration } from '../runtime';

export function createDependencies(
    configuration: RuntimeConfiguration,
    storage?: Storage
): Dependencies {
    const backend =
        configuration.mode === 'mock'
            ? new MockWorkspaceBackend(createMockEditorBackend(storage), storage)
            : null;
    const transport = backend
        ? new MockHttpTransport(backend.request)
        : new FetchHttpTransport(configuration.apiBaseUrl);
    const schemas = new TransportSchemaRepo(transport);
    const analyses = new TransportAnalysisRepo(transport);

    return {
        mode: configuration.mode,
        listSchemas: new ListSchemas(schemas),
        getSchema: new GetSchema(schemas),
        getAnalysis: new GetAnalysis(analyses),
        createAnalysis: new CreateAnalysis(analyses),
        recordSchemaSaved: new RecordSchemaSaved(schemas),
        editorRequest: backend?.request,
        apiBaseUrl: configuration.apiBaseUrl,
        createId: () => crypto.randomUUID(),
        loadEditor: () => loadEditor(configuration.editorManifestUrl),
    };
}
