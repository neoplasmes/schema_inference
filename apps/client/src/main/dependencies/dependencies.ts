import { CreateAnalysis } from '../../app/commands/create_analysis';
import { RecordSchemaSaved } from '../../app/commands/record_schema_saved';
import { GetAnalysis } from '../../app/queries/get_analysis';
import { GetSchema } from '../../app/queries/get_schema';
import { ListSchemas } from '../../app/queries/list_schemas';
import { TransportAnalysisRepo } from '../../env/repos/analysis';
import { TransportSchemaRepo } from '../../env/repos/schema';
import { MockHttpTransport } from '../../env/transport';
import type { Dependencies } from '../../ui/di';
import { createMockEditorBackend } from '../mock_editor';
import { MockWorkspaceBackend } from '../mock_workspace';
import { loadEditor } from '../editor_loader';

export function createDependencies(storage?: Storage): Dependencies {
    const backend = new MockWorkspaceBackend(createMockEditorBackend(storage), storage);
    const transport = new MockHttpTransport(backend.request);
    const schemas = new TransportSchemaRepo(transport);
    const analyses = new TransportAnalysisRepo(transport);

    return {
        listSchemas: new ListSchemas(schemas),
        getSchema: new GetSchema(schemas),
        getAnalysis: new GetAnalysis(analyses),
        createAnalysis: new CreateAnalysis(analyses),
        recordSchemaSaved: new RecordSchemaSaved(schemas),
        editorRequest: backend.request,
        createId: () => crypto.randomUUID(),
        loadEditor,
    };
}
