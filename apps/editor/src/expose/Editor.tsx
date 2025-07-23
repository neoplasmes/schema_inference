import EditorApplication from '../app/EditorApplication';
import type { EditorResource } from '../application/ports/repos/schema.repo';

export type { EditorResource } from '../application/ports/repos/schema.repo';

export type EditorProps = {
    resource: EditorResource;
    apiBaseUrl: string;
    onExit?: () => void;
    onSaved?: (result: { schemaId: string; revision: string; savedAt: string }) => void;
};

export default function Editor(props: EditorProps): React.JSX.Element {
    return <EditorApplication {...props} />;
}
