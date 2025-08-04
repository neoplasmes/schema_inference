import { useMemo } from 'react';
import { EditorDependenciesProvider, type EditorDependenciesFactory } from '../../ui/di';
import { EditorApplication, type EditorProps } from '../../ui/pages/editor';
import { createEditorDependencies } from '../dependencies';

export function Editor(props: EditorProps): React.JSX.Element {
    const dependencies = useMemo<EditorDependenciesFactory>(
        () => fixture => createEditorDependencies(props.apiBaseUrl, fixture),
        [props.apiBaseUrl]
    );

    return (
        <EditorDependenciesProvider value={dependencies}>
            <EditorApplication {...props} />
        </EditorDependenciesProvider>
    );
}
