import { loadRemote, registerRemotes } from '@module-federation/enhanced/runtime';
import type { ComponentType } from 'react';
import type { EditorProps } from 'schema_editor/Editor';

export async function loadEditor(): Promise<{
    default: ComponentType<EditorProps>;
}> {
    const response = await fetch('/editor-runtime.json', {
        cache: 'no-store',
    });

    if (!response.ok) {
        throw new Error('The editor runtime configuration is unavailable.');
    }

    const configuration: unknown = await response.json();

    if (
        !configuration ||
        typeof configuration !== 'object' ||
        !('editorManifestUrl' in configuration) ||
        typeof configuration.editorManifestUrl !== 'string' ||
        !configuration.editorManifestUrl
    ) {
        throw new Error('The editor manifest URL is missing.');
    }

    registerRemotes(
        [
            {
                name: 'schema_editor',
                entry: configuration.editorManifestUrl,
            },
        ],
        {
            force: true,
        }
    );
    const module = await loadRemote<{
        default: ComponentType<EditorProps>;
    }>('schema_editor/Editor');

    if (!module?.default) {
        throw new Error('The editor module is unavailable.');
    }

    return module;
}
