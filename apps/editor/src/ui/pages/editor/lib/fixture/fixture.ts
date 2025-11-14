import { EditorDocument } from '../../../../../app/editor/document';
import type { FixtureData, MemberPage } from '../../../../../app/ports/repos/schema';
import type { BoardModel } from '../../../../../board';
import type {
    MemberSummary,
    SchemaNode,
    Snapshot,
} from '../../../../../core/entities/schema';

export function fixtureDocument(
    model: BoardModel,
    snapshot: Snapshot = {
        resource: 'schema',
        id: 'standalone-fixture',
        revision: 'fixture-1',
    },
    title = 'Orders'
): {
    document: EditorDocument;
    fixture: FixtureData;
} {
    const document = new EditorDocument({
        snapshot,
        title,
        profile: {
            syntax: 'xml',
            dialect: 'xsd-1.0',
        },
        rootNodeId: model.cards[0]?.nodeId ?? 'empty',
    });
    const pages = new Map<string, MemberPage>();
    const cardsById = new Map(
        model.cards.map(card => [
            card.blockId,
            card,
        ])
    );
    const targets = new Map(
        model.connections.map(edge => [
            `${edge.sourceBlockId}/${edge.sourceMemberId}`,
            edge.targetBlockId,
        ])
    );

    for (const card of model.cards) {
        const collectionId = card.collectionId ?? `members-${card.blockId}`;
        const items: MemberSummary[] = card.rows.map(row => {
            const target = targets.get(`${card.blockId}/${row.memberId}`);
            const targetCard = target ? cardsById.get(target) : undefined;
            const valueNodeId = targetCard?.nodeId ?? `${card.nodeId}/${row.memberId}`;

            if (!targetCard) {
                document.integrateNode(
                    row.icon === 'attribute'
                        ? {
                              id: valueNodeId,
                              kind: 'scalar',
                              scalarType: 'string',
                              constraints: {},
                          }
                        : {
                              id: valueNodeId,
                              kind: 'xmlElement',
                              name: {
                                  namespaceUri: null,
                                  localName: row.name,
                              },
                              contentNodeId: `${valueNodeId}/value`,
                              nillable: false,
                          }
                );
                document.integrateNode({
                    id: `${valueNodeId}/value`,
                    kind: 'scalar',
                    scalarType: 'string',
                    constraints: {},
                });
            }

            return {
                member:
                    row.icon === 'attribute'
                        ? {
                              id: row.memberId,
                              kind: 'xmlAttribute',
                              name: {
                                  namespaceUri: null,
                                  localName: row.name,
                              },
                              required: row.occurrenceLabel !== '0..1',
                              valueNodeId,
                          }
                        : {
                              id: row.memberId,
                              kind: 'xmlParticle',
                              valueNodeId,
                              minOccurs: row.occurrenceLabel?.startsWith('0') ? 0 : 1,
                              maxOccurs: row.occurrenceLabel?.includes('∞') ? null : 1,
                          },
                valueSummary: {
                    id: valueNodeId,
                    kind: 'xmlElement',
                    label: row.name,
                    directMemberCount: row.expandable ? 1 : 0,
                    descendantCount: row.expandable ? null : 0,
                },
            };
        });
        const attributes = items.filter(item => item.member.kind === 'xmlAttribute');
        const particles = items.filter(item => item.member.kind === 'xmlParticle');
        const attributeId = `${collectionId}/attributes`;
        const complexId = `${card.nodeId}/complex`;
        const groupId = `${card.nodeId}/sequence`;
        const totalParticles = Math.max(
            particles.length,
            card.rowWindow.totalItems - attributes.length
        );
        const nodes: SchemaNode[] = [
            {
                id: card.nodeId,
                kind: 'xmlElement',
                name: {
                    namespaceUri: null,
                    localName: card.title,
                },
                contentNodeId: complexId,
                nillable: false,
            },
            {
                id: complexId,
                kind: 'xmlComplex',
                attributes: {
                    id: attributeId,
                    totalItems: attributes.length,
                },
                particleNodeId: groupId,
                mixed: false,
            },
            {
                id: groupId,
                kind: 'xmlGroup',
                compositor: 'sequence',
                particles: {
                    id: collectionId,
                    totalItems: totalParticles,
                },
            },
        ];

        for (const node of nodes) {
            document.integrateNode(node);
        }

        for (const [id, rows, total] of [
            [
                attributeId,
                attributes,
                attributes.length,
            ],
            [
                collectionId,
                particles,
                totalParticles,
            ],
        ] as const) {
            const page: MemberPage = {
                snapshot: document.manifest.snapshot,
                collectionId: id,
                scopeId: null,
                items: rows,
                totalItems: total,
                nextCursor:
                    id === collectionId && card.rowWindow.hasMore
                        ? String(rows.length)
                        : null,
            };
            pages.set(id, page);
            document.addPage(page);

            if (id === collectionId) {
                document.setCollectionLoadState(
                    id,
                    card.rowWindow.state,
                    card.rowWindow.error
                );
            }
        }
    }

    return {
        document,
        fixture: {
            manifest: document.manifest,
            nodes: document.nodes,
            pages,
        },
    };
}
