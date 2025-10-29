import type { DocumentFormat, DocumentInput } from '../../../../../core/entities';

function formatFor(name: string): DocumentFormat {
    const extension = name.split('.').pop()?.toLowerCase();

    if (extension === 'xml' || extension === 'json') {
        return extension;
    }

    if (extension === 'yaml' || extension === 'yml') {
        return 'yaml';
    }

    throw new Error(`${name}: choose an XML, YAML or JSON file.`);
}

export async function readDocument(file: File): Promise<DocumentInput> {
    const format = formatFor(file.name);

    if (file.size > 5_000_000) {
        throw new Error(`${file.name}: the workspace accepts files up to 5 MB.`);
    }

    const content = await file.text();

    if (!content.trim()) {
        throw new Error(`${file.name} is empty.`);
    }

    const size = new TextEncoder().encode(content).byteLength;

    if (size > 5_000_000) {
        throw new Error(`${file.name}: the workspace accepts files up to 5 MB.`);
    }

    return {
        name: file.name,
        size,
        format,
        content,
    };
}
