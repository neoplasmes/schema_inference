import { DocumentEditError } from './document_edit.error';
import { nodeCollections } from '../../entities/schema';
import type { DocumentEditState } from './contracts';

/** A contained field cannot become its own ancestor; references are not containment edges. */
export function checkMoveAncestry(
    state: DocumentEditState,
    sourceNodeId: string,
    targetNodeId: string
): void {
    const pending = [sourceNodeId];
    const visited = new Set<string>();
    let incomplete = false;

    while (pending.length > 0) {
        const id = pending.pop();

        if (id === undefined || visited.has(id)) {
            continue;
        }

        if (id === targetNodeId) {
            throw new DocumentEditError(
                'A field cannot be moved into its own descendants.'
            );
        }

        visited.add(id);
        const node = state.nodes.get(id);

        if (!node) {
            incomplete = true;
            continue;
        }

        if (node.kind === 'xmlElement') {
            pending.push(node.contentNodeId);
        }

        if (node.kind === 'xmlComplex' && node.particleNodeId) {
            pending.push(node.particleNodeId);
        }

        if (node.kind === 'xmlComplex' && node.simpleContentNodeId) {
            pending.push(node.simpleContentNodeId);
        }

        if (node.kind === 'array') {
            pending.push(node.itemsNodeId);
        }

        const [collection] = nodeCollections(node);

        if (collection) {
            const window = state.collections.get(collection.id);

            if (!window?.complete || window.items.length !== window.totalItems) {
                incomplete = true;
            }

            for (const row of window?.items ?? []) {
                if (
                    row.valueSummary.kind !== 'scalar' &&
                    row.valueSummary.kind !== 'ref'
                ) {
                    pending.push(row.member.valueNodeId);
                }
            }
        }
    }

    if (incomplete) {
        throw new DocumentEditError(
            'Load the source branch before moving it between collections so its ancestry can be checked.'
        );
    }
}
