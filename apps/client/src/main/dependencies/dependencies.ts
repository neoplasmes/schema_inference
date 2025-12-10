import { CreateAnalysis } from '../../app/commands/createAnalysis';
import { DeleteAnalysis } from '../../app/commands/deleteAnalysis';
import { DeleteSchema } from '../../app/commands/deleteSchema';
import { EndSession } from '../../app/commands/endSession';
import { RecordSchemaSaved } from '../../app/commands/recordSchemaSaved';
import { GetAnalysis } from '../../app/queries/getAnalysis';
import { GetSchema } from '../../app/queries/getSchema';
import { GetSession } from '../../app/queries/getSession';
import { ListAnalyses } from '../../app/queries/listAnalyses';
import { ListSchemas } from '../../app/queries/listSchemas';
import { TransportAnalysisRepo } from '../../env/repos/analysis';
import { TransportSchemaRepo } from '../../env/repos/schema';
import { TransportSessionRepo } from '../../env/repos/session';
import { FetchHttpTransport, MockHttpTransport } from '../../env/transport';
import type { Dependencies } from '../../ui/di';
import { createMockEditorBackend } from '../mockEditor';
import { MockWorkspaceBackend } from '../mockWorkspace';
import { loadEditor } from '../editorLoader';
import { createLoginRedirect } from '../login';
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
    const sessions = new TransportSessionRepo(transport);
    const redirectToLogin = createLoginRedirect(
        configuration.apiBaseUrl,
        window.location
    );

    sessions.attachInterceptors(redirectToLogin);

    return {
        mode: configuration.mode,
        listSchemas: new ListSchemas(schemas),
        getSchema: new GetSchema(schemas),
        getAnalysis: new GetAnalysis(analyses),
        listAnalyses: new ListAnalyses(analyses),
        getSession: new GetSession(sessions),
        createAnalysis: new CreateAnalysis(analyses),
        recordSchemaSaved: new RecordSchemaSaved(schemas),
        deleteSchema: new DeleteSchema(schemas),
        deleteAnalysis: new DeleteAnalysis(analyses),
        endSession: new EndSession(sessions),
        navigate: url => window.location.assign(url),
        redirectToLogin,
        editorRequest: backend?.request,
        apiBaseUrl: configuration.apiBaseUrl,
        createId: () => crypto.randomUUID(),
        loadEditor: () => loadEditor(configuration.editorManifestUrl),
    };
}
