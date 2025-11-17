import { loadRemote, registerRemotes } from '@module-federation/enhanced/runtime';
import type { ComponentType } from 'react';
import type { EditorProps } from 'schema_editor/Editor';

async function configuredManifest(): Promise<string> {
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

    return configuration.editorManifestUrl;
}

export async function loadEditor(editorManifestUrl?: string): Promise<{
    default: ComponentType<EditorProps>;
}> {
    const manifestUrl = editorManifestUrl ?? (await configuredManifest());

    registerRemotes(
        [
            {
                name: 'schema_editor',
                entry: manifestUrl,
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
