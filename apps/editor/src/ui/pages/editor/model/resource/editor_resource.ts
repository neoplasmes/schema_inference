import type { EditorResource } from '../../../../../app/ports/repos/schema';

export type { EditorResource } from '../../../../../app/ports/repos/schema';

export type EditorProps = {
    resource: EditorResource;
    apiBaseUrl: string;
    request?: (path: string, options?: RequestInit) => Promise<Response>;
    onExit?: () => void;
    onSaved?: (result: { schemaId: string; revision: string; savedAt: string }) => void;
};
