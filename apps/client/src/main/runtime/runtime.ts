export interface RuntimeConfiguration {
    mode: 'mock' | 'api';
    apiBaseUrl: string;
    editorManifestUrl?: string;
}

export async function loadRuntimeConfiguration(): Promise<RuntimeConfiguration> {
    const response = await fetch('/workspace-runtime.json', {
        cache: 'no-store',
    });

    if (!response.ok) {
        throw new Error('The workspace configuration is unavailable.');
    }

    const value: unknown = await response.json();

    if (
        !value ||
        typeof value !== 'object' ||
        !('mode' in value) ||
        (value.mode !== 'mock' && value.mode !== 'api') ||
        !('apiBaseUrl' in value) ||
        typeof value.apiBaseUrl !== 'string' ||
        ('editorManifestUrl' in value &&
            (typeof value.editorManifestUrl !== 'string' || !value.editorManifestUrl))
    ) {
        throw new Error('The workspace configuration is invalid.');
    }

    return {
        mode: value.mode,
        apiBaseUrl: value.apiBaseUrl,
        ...('editorManifestUrl' in value
            ? {
                  editorManifestUrl: value.editorManifestUrl as string,
              }
            : {}),
    };
}
