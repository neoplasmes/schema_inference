import type { Query } from '../../contracts';
import {
    nodeCollections,
    type SchemaNode,
    type Snapshot,
} from '../../../core/entities/schema';
import type { MemberPage, ReadOptions, SchemaRepository } from '../../ports/repos/schema';
import type { EntityRef } from '../../../core/entities';

export type LoadedBranch = Readonly<{
    rootNodeId: string;
    title: string;
    nodes: readonly SchemaNode[];
    pages: readonly MemberPage[];
}>;

export type LoadBranchInput = { snapshot: Snapshot; nodeId: string };

/** Opens a bounded chain of XML/content wrappers, without fetching member subtrees. */
export class LoadBranchQuery implements Query<LoadBranchInput, LoadedBranch> {
    readonly name = 'schema.branch';

    constructor(private readonly repository: SchemaRepository) {}

    async execute(input: LoadBranchInput, options?: ReadOptions): Promise<LoadedBranch> {
        const nodes: SchemaNode[] = [];
        const pages: MemberPage[] = [];
        const seen = new Set<string>();
        let next: string | null = input.nodeId;
        let title = '';

        while (next !== null) {
            if (seen.has(next) || seen.size >= 128) {
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
                      ? (node.particleNodeId ?? node.simpleContentNodeId ?? null)
                      : node.kind === 'array'
                        ? node.itemsNodeId
                        : null;
        }

        return { rootNodeId: input.nodeId, title: title || 'document', nodes, pages };
    }

    reads(input: LoadBranchInput): readonly EntityRef[] {
        return [`schema.snapshot:${input.snapshot.id}/${input.snapshot.revision}`];
    }
}
