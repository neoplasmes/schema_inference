import type { EditorDocument } from '../../../../../app/editor/document';
import type { SchemaMember } from '../../../../../core/entities/schema';

export function collectionForMember(
    document: EditorDocument,
    nodeId: string,
    kind: SchemaMember['kind']
): string | null {
    let node = document.nodes.get(nodeId);
    const seen = new Set<string>();

    while (node && !seen.has(node.id) && seen.size < 128) {
        seen.add(node.id);

        if (kind === 'xmlAttribute' && node.kind === 'xmlComplex') {
            return node.attributes.id;
        }

        if (kind === 'xmlParticle' && node.kind === 'xmlGroup') {
            return node.particles.id;
        }

        if (kind === 'property' && node.kind === 'object') {
            return node.properties.id;
        }

        if (kind === 'option' && node.kind === 'union') {
            return node.options.id;
        }

        const next =
            node.kind === 'xmlElement'
                ? node.contentNodeId
                : node.kind === 'xmlComplex'
                  ? (node.particleNodeId ?? node.simpleContentNodeId ?? null)
                  : node.kind === 'array'
                    ? node.itemsNodeId
                    : null;
        node = next === null ? undefined : document.nodes.get(next);
    }

    return null;
}
