import { nodeCollections, type SchemaNode, type Snapshot } from '../../../core/schema';
import type {
    MemberPage,
    ReadOptions,
    SchemaRepository,
} from '../../ports/repos/schema.repo';
import type { SchemaReference } from '../../../core/schema_reference';

export type LoadedBranch = Readonly<{
    rootNodeId: string;
    title: string;
    nodes: readonly SchemaNode[];
    pages: readonly MemberPage[];
}>;

/** Opens a bounded chain of XML/content wrappers, without fetching member subtrees. */
export class LoadBranchQuery {
    readonly name = 'schema.branch';

    constructor(private readonly repository: SchemaRepository) {}

    async execute(
        input: { snapshot: Snapshot; nodeId: string },
        options?: ReadOptions
    ): Promise<LoadedBranch> {
        const nodes: SchemaNode[] = [];
        const pages: MemberPage[] = [];
        const seen = new Set<string>();
        let next: string | null = input.nodeId;
        let title = '';

        while (next !== null) {
            if (seen.has(next) || seen.size >= 8) {
                throw new Error(
                    'The schema contains an invalid or excessively deep content wrapper chain.'
                );
            }

            seen.add(next);
            const node = await this.repository.readNode(input.snapshot, next, options);
            nodes.push(node);

            if (node.kind === 'xmlElement' && !title) {
                title = node.name.localName;
            }

            for (const collection of nodeCollections(node)) {
                pages.push(
                    await this.repository.readMembers(
                        input.snapshot,
                        collection.id,
                        null,
                        options
                    )
                );
            }

            next =
                node.kind === 'xmlElement'
                    ? node.contentNodeId
                    : node.kind === 'xmlComplex'
                      ? node.particleNodeId
                      : node.kind === 'array'
                        ? node.itemsNodeId
                        : null;
        }

        return { rootNodeId: input.nodeId, title: title || input.nodeId, nodes, pages };
    }

    reads(input: { snapshot: Snapshot; nodeId: string }): readonly SchemaReference[] {
        return [
            {
                type: 'schema.node',
                id: `${input.snapshot.id}/${input.snapshot.revision}/${input.nodeId}`,
            },
        ];
    }
}
