import type {
    BoardCard,
    BoardConnection,
    BoardModel,
    BoardRow,
    BoardViewport,
} from '../src/board';
import { references, type ReferenceCrop } from './references';

export const sceneIds = [
    'main',
    'variants',
    'replace-preview',
    'card-anatomy',
    'loading',
    'lod',
    'lod-overview',
    'lod-working',
    'lod-detailed',
    'builder',
    'stress',
    'stress-large',
    'dense',
    'paged',
] as const;

export type SceneId = (typeof sceneIds)[number];

export type PlaygroundScene = Readonly<{
    id: SceneId;
    title?: string;
    referenceFile: string | null;
    viewport: Readonly<{
        width: number;
        height: number;
    }>;
    board: BoardModel;
    camera: BoardViewport;
    shell: 'evidence' | 'builder' | 'none';
    crops: readonly ReferenceCrop[];
    panels?: readonly Readonly<{
        id: string;
        board: BoardModel;
        camera: BoardViewport;
        containerRect: Readonly<{
            x: number;
            y: number;
            width: number;
            height: number;
        }>;
    }>[];
}>;

function row(
    memberId: string,
    name: string,
    typeLabel = 'string',
    extra: Partial<BoardRow> = {}
): BoardRow {
    return {
        memberId,
        name,
        typeLabel,
        icon: 'element',
        change: 'unchanged',
        expandable: false,
        expanded: false,
        ...extra,
    };
}

function card(
    blockId: string,
    title: string,
    x: number,
    y: number,
    width: number,
    rows: readonly BoardRow[],
    extra: Partial<BoardCard> = {}
): BoardCard {
    return {
        blockId,
        nodeId: `node-${blockId}`,
        collectionId: `members-${blockId}`,
        title,
        position: {
            x,
            y,
        },
        width,
        pinned: true,
        collapsed: false,
        suggested: false,
        rows,
        rowWindow: {
            firstMemberId: rows[0]?.memberId ?? null,
            totalItems: rows.length,
            state: 'complete',
            hasMore: false,
        },
        ...extra,
    };
}

function edge(
    sourceBlockId: string,
    sourceMemberId: string,
    targetBlockId: string,
    extra: Partial<BoardConnection> = {}
): BoardConnection {
    return {
        id: `${sourceBlockId}/${sourceMemberId}/${targetBlockId}`,
        sourceBlockId,
        sourceMemberId,
        targetBlockId,
        kind: 'containment',
        state: 'normal',
        ...extra,
    };
}

const paymentVariants = [
    {
        variantId: 'card',
        scopeId: 'orders/payment',
        title: 'Card',
        count: 10,
        total: 15,
    },
    {
        variantId: 'invoice',
        scopeId: 'orders/payment',
        title: 'Invoice',
        count: 5,
        total: 15,
    },
] as const;

function main(): BoardModel {
    return {
        version: 1,
        state: 'ready',
        selection: {
            blockId: 'order',
            memberId: 'payment',
        },
        cards: [
            card(
                'address-definition',
                'Address',
                120,
                430,
                238,
                [
                    row('street', 'street'),
                    row('city', 'city'),
                    row('zip', 'zip'),
                ],
                {
                    subtitle: 'definition',
                }
            ),
            card('catalog', 'catalog', 1060, 600, 238, [
                row('catalog-sku', 'sku'),
                row('catalog-title', 'title'),
            ]),
            card(
                'order',
                'order',
                300,
                110,
                248,
                [
                    row('id', 'id', 'string', {
                        icon: 'attribute',
                    }),
                    row('customer', 'customer', 'complex', {
                        expandable: true,
                        expanded: true,
                    }),
                    row('payment', 'payment', 'choice', {
                        expandable: true,
                        expanded: true,
                        variantsCount: 2,
                    }),
                    row('items', 'items', 'complex', {
                        expandable: true,
                        expanded: true,
                    }),
                    row('delivery', 'delivery', 'date', {
                        occurrenceLabel: '0..1',
                    }),
                ],
                {
                    subtitle: 'sequence',
                }
            ),
            card('customer', 'customer', 620, 90, 238, [
                row('name', 'name'),
                row('email', 'email', 'string', {
                    nameAlias: '+ e-mail',
                }),
                row('phone', 'phone', 'string', {
                    occurrenceLabel: '0..1',
                }),
                row('address', 'address', 'complex', {
                    expandable: true,
                    branch: {
                        totalItems: 6,
                        state: 'notRequested',
                    },
                }),
            ]),
            card(
                'payment',
                'payment',
                620,
                300,
                268,
                [
                    row('amount', 'amount', 'decimal'),
                    row('currency', 'currency'),
                    row('number', 'number'),
                    row('holder', 'holder', 'string', {
                        occurrenceLabel: '0..1',
                    }),
                ],
                {
                    suggested: true,
                    variants: paymentVariants,
                    activeVariantId: 'card',
                }
            ),
            card(
                'item',
                'item',
                620,
                540,
                238,
                [
                    row('product', 'product'),
                    row('quantity', 'quantity', 'integer'),
                    row('price', 'price', 'decimal'),
                ],
                {
                    subtitle: '1..∞',
                    rowWindow: {
                        firstMemberId: 'product',
                        totalItems: 14,
                        state: 'partial',
                        hasMore: true,
                    },
                }
            ),
        ],
        connections: [
            edge('order', 'customer', 'customer'),
            edge('order', 'payment', 'payment', {
                state: 'selected',
            }),
            edge('order', 'items', 'item'),
        ],
    };
}

function variants(): BoardModel {
    return {
        version: 1,
        state: 'ready',
        selection: {
            blockId: 'payment',
            memberId: null,
        },
        diagnosticLod: 'detailed',
        cards: [
            card(
                'payment',
                'payment',
                80,
                120,
                380,
                [
                    row('amount', 'amount', 'decimal'),
                    row('currency', 'currency'),
                    row('number', 'number', 'string', {
                        change: 'removed',
                    }),
                    row('holder', 'holder', 'string', {
                        change: 'removed',
                        occurrenceLabel: '0..1',
                    }),
                    row('inn', 'inn', 'string', {
                        change: 'added',
                    }),
                    row('bank', 'bank', 'complex', {
                        change: 'added',
                        expandable: true,
                        expanded: true,
                    }),
                    row('bic', 'bic', 'string', {
                        change: 'added',
                        occurrenceLabel: '0..1',
                    }),
                ],
                {
                    variants: paymentVariants,
                    activeVariantId: 'invoice',
                    subtitle: 'Previewing Invoice',
                    metrics: {
                        header: 40,
                        row: 34,
                        rowGlyphs: false,
                        separators: true,
                        reserveGlyphColumn: true,
                    },
                }
            ),
            card(
                'bank',
                'bank',
                560,
                372,
                220,
                [
                    row('bank-name', 'name'),
                    row('account', 'account'),
                ],
                {
                    subtitle: 'Preview',
                    metrics: {
                        header: 40,
                        row: 32,
                        rowGlyphs: false,
                        separators: true,
                        headerLayout: 'plain',
                    },
                }
            ),
        ],
        connections: [
            edge('payment', 'bank', 'bank', {
                kind: 'preview',
            }),
        ],
    };
}

function replacePreview(): BoardModel {
    return {
        version: 1,
        state: 'ready',
        selection: null,
        cards: [
            card('order', 'order', 60, 80, 228, [
                row('id', 'id'),
                row('customer', 'customer'),
                row('payment', 'payment'),
            ]),
            card('payment', 'payment', 340, 300, 248, [
                row('amount', 'amount'),
                row('number', 'number'),
            ]),
            card('customer', 'customer', 900, 120, 228, [
                row('name', 'name'),
                row('email', 'email'),
            ]),
        ],
        connections: [],
    };
}

function anatomy(): BoardModel {
    const stateRows = [
        row('idle', 'title'),
        row('hover', 'title'),
        row('selected', 'title'),
        row('error', ''),
        row('unloaded', 'dimensions', 'fields', {
            expandable: true,
            typeCount: 3,
        }),
        row('reference', 'billingAddress', '↗ Address', {
            icon: 'reference',
            typeEmphasis: true,
        }),
        row('recursion', 'children', '⟳ Category', {
            icon: 'reference',
            typeEmphasis: true,
        }),
        row('spelling', 'email', 'string', {
            nameAlias: '+ e-mail',
        }),
    ];

    return {
        version: 1,
        state: 'ready',
        diagnosticLod: 'detailed',
        selection: {
            blockId: 'state-selected',
            memberId: 'selected',
        },
        cards: [
            card(
                'product',
                'product',
                60,
                64,
                420,
                [
                    row('sku', 'sku', 'string', {
                        icon: 'attribute',
                        occurrenceLabel: '1',
                    }),
                    row('title', 'title', 'string', {
                        occurrenceLabel: '1',
                    }),
                    row('price', 'price', 'complex', {
                        expandable: true,
                        expanded: true,
                        occurrenceLabel: '1',
                    }),
                    row('weight', 'weight', 'decimal', {
                        occurrenceLabel: '0..1',
                    }),
                    row('tags', 'tags', 'string', {
                        occurrenceLabel: '0..∞',
                    }),
                    row('attrs-outside-window', 'attrs', 'complex', {
                        expandable: true,
                        expanded: true,
                    }),
                    row('media-outside-window', 'media', 'complex', {
                        expandable: true,
                        expanded: true,
                    }),
                ],
                {
                    subtitle: 'sequence',
                    namespace: 'urn:shop:catalog',
                    metrics: {
                        header: 44,
                        row: 36,
                        boundary: 28,
                        footer: 40,
                        occurrenceColumn: true,
                        rowGlyphs: true,
                        rowLimit: 5,
                        separators: false,
                    },
                    rowWindow: {
                        firstMemberId: 'sku',
                        totalItems: 412,
                        state: 'partial',
                        hasMore: true,
                        firstIndex: 2,
                        loadedItems: 50,
                    },
                }
            ),
            ...stateRows.map((stateRow, index) =>
                card(
                    `state-${stateRow.memberId}`,
                    stateRow.name,
                    880,
                    95 + index * 67,
                    280,
                    [
                        stateRow,
                    ],
                    {
                        display: 'summary',
                        subtitle: stateRow.typeLabel,
                        metrics: {
                            row: 28,
                            rowGlyphs: false,
                            occurrenceColumn: false,
                        },
                    }
                )
            ),
            card('hidden-attributes', 'Attributes', 60, -400, 200, [
                row('hidden-attribute', 'attribute'),
            ]),
            card('hidden-media', 'Media', 320, -400, 200, [
                row('hidden-media-value', 'media'),
            ]),
            card(
                'renaming',
                'title',
                60,
                485,
                370,
                [
                    row('renaming-original', 'title'),
                    row('renaming-title', 'net_weight', 'decimal'),
                ],
                {
                    display: 'summary',
                    metrics: {
                        row: 34,
                        rowGlyphs: false,
                    },
                }
            ),
            card(
                'reordering',
                'weight',
                470,
                485,
                370,
                [
                    row('reorder-sku', 'sku'),
                    row('reorder-title', 'title'),
                    row('reorder-weight', 'weight', 'decimal'),
                ],
                {
                    display: 'summary',
                    metrics: {
                        row: 32.6666666667,
                        rowGlyphs: false,
                    },
                }
            ),
        ],
        connections: [
            edge('product', 'attrs-outside-window', 'hidden-attributes'),
            edge('product', 'media-outside-window', 'hidden-media'),
        ],
    };
}

function loading(): BoardModel {
    const x = [
        48,
        429.328125,
        810.65625,
    ];

    return {
        version: 1,
        state: 'ready',
        selection: {
            blockId: 'loading-parent',
            memberId: 'address-child',
        },
        cards: [
            card(
                'not-requested',
                'address',
                x[0],
                253.328125,
                168,
                [
                    row('unrequested-address', 'address', 'complex', {
                        expandable: true,
                        branch: {
                            totalItems: 6,
                            state: 'notRequested',
                        },
                    }),
                ],
                {
                    display: 'summary',
                    subtitle: 'complex',
                }
            ),
            card(
                'loading-parent',
                'address',
                x[1],
                244.328125,
                168,
                [
                    row('address-child', 'address', 'complex', {
                        expandable: true,
                        expanded: true,
                    }),
                ],
                {
                    display: 'summary',
                    subtitle: 'complex',
                }
            ),
            card('loading', 'address', 625.328125, 235.328125, 120, [], {
                rowWindow: {
                    firstMemberId: null,
                    totalItems: 6,
                    state: 'loading',
                    hasMore: false,
                },
            }),
            card(
                'partial',
                'product',
                x[2],
                165.328125,
                238,
                [
                    row('partial-sku', 'sku'),
                    row('partial-title', 'title'),
                ],
                {
                    rowWindow: {
                        firstMemberId: 'partial-sku',
                        totalItems: 412,
                        state: 'partial',
                        hasMore: true,
                        loadedItems: 50,
                    },
                }
            ),
            card(
                'complete',
                'item',
                x[0],
                446.65625,
                238,
                [
                    row('complete-product', 'product'),
                    row('complete-quantity', 'quantity'),
                ],
                {
                    rowWindow: {
                        firstMemberId: 'complete-product',
                        totalItems: 14,
                        state: 'complete',
                        hasMore: false,
                        loadedItems: 14,
                    },
                }
            ),
            card(
                'failed',
                'product',
                x[1],
                470.65625,
                238,
                [
                    row('failed-sku', 'sku'),
                ],
                {
                    rowWindow: {
                        firstMemberId: 'failed-sku',
                        totalItems: 412,
                        state: 'failed',
                        hasMore: true,
                        error: "Page 2 didn't load",
                    },
                }
            ),
            card('empty', 'extensions', x[2], 479.65625, 238, []),
            card('unknown', 'customer', x[0], 815.984375, 238, [], {
                display: 'summary',
                subtitle: '18 · ? nested',
            }),
            card(
                'recursive',
                'children',
                x[1],
                815.984375,
                168,
                [
                    row('category-ref', 'children', '↻'),
                ],
                {
                    display: 'summary',
                }
            ),
            card(
                'recursive-definition',
                'Category',
                625.328125,
                819.984375,
                127.296875,
                [
                    row('category-link', 'Category', 'go to'),
                ],
                {
                    display: 'summary',
                    metrics: {
                        row: 20,
                    },
                }
            ),
        ],
        connections: [
            edge('loading-parent', 'address-child', 'loading', {
                state: 'unloaded',
            }),
            edge('recursive', 'category-ref', 'recursive-definition', {
                kind: 'reference',
            }),
        ],
    };
}

function builder(): BoardModel {
    return {
        version: 1,
        state: 'ready',
        selection: {
            blockId: 'item',
            memberId: 'price',
        },
        cards: [
            card(
                'price-list',
                'priceList',
                320,
                120,
                258,
                [
                    row('currency', 'currency', 'string', {
                        icon: 'attribute',
                    }),
                    row('valid-from', 'validFrom', 'date', {
                        icon: 'attribute',
                    }),
                    row('item-member', 'item', 'complex', {
                        occurrenceLabel: '1..∞',
                        expandable: true,
                        expanded: true,
                    }),
                ],
                {
                    subtitle: 'sequence',
                }
            ),
            card(
                'item',
                'item',
                660,
                160,
                268,
                [
                    row('sku', 'sku'),
                    row('title', 'title'),
                    row('price', 'price', 'decimal'),
                    row('discount', 'discount', 'choice · 1 option'),
                ],
                {
                    subtitle: 'sequence',
                }
            ),
        ],
        connections: [
            edge('price-list', 'item-member', 'item'),
        ],
    };
}

function lod(kind: 'overview' | 'working' | 'detailed'): BoardModel {
    if (kind === 'detailed') {
        return {
            version: 1,
            state: 'ready',
            selection: null,
            diagnosticLod: kind,
            cards: [
                card(
                    'customer',
                    'customer',
                    1056,
                    126,
                    420,
                    [
                        row('name', 'name', 'string', {
                            observation: {
                                count: 15,
                                total: 15,
                            },
                        }),
                        row('email', 'email', 'string', {
                            observation: {
                                count: 14,
                                total: 15,
                            },
                            nameAlias: '+ e-mail 3',
                        }),
                        row('phone', 'phone', 'string', {
                            occurrenceLabel: '0..1',
                            observation: {
                                count: 6,
                                total: 15,
                            },
                            warning: 'phone has two value types\nstring 4 · integer 2',
                        }),
                    ],
                    {
                        subtitle: '1 note',
                        subtitleEmphasis: true,
                        note: '+ Add element',
                    }
                ),
            ],
            connections: [],
        };
    }

    const overview = kind === 'overview';
    const origin = overview
        ? {
              x: 68,
              y: 196,
          }
        : {
              x: 572,
              y: 136,
          };
    const childrenX = overview ? 268 : 812;

    return {
        version: 1,
        state: 'ready',
        selection: {
            blockId: 'order',
            memberId: 'payment',
        },
        diagnosticLod: kind,
        cards: [
            card('order', 'order', origin.x, origin.y, overview ? 100 : 180, [
                row('id', 'id'),
                row('customer', 'customer', 'complex', {
                    expandable: true,
                    expanded: true,
                }),
                row('payment', 'payment', 'choice', {
                    expandable: true,
                    expanded: true,
                }),
                row('items', 'items', 'complex'),
                ...(overview
                    ? [
                          row('delivery', 'delivery', 'date'),
                      ]
                    : []),
            ]),
            card('customer', 'customer', childrenX, 140, overview ? 90 : 160, [
                row('name', 'name'),
                row('email', 'email'),
                ...(overview
                    ? [
                          row('phone', 'phone'),
                          row('address', 'address'),
                      ]
                    : []),
            ]),
            card(
                'payment',
                'payment',
                childrenX,
                overview ? 260 : 290,
                overview ? 90 : 160,
                [
                    row('amount', 'amount', 'decimal'),
                    row('number', 'number'),
                ],
                overview
                    ? {
                          subtitle: '2 variants',
                      }
                    : {}
            ),
            ...(overview
                ? [
                      card('items', 'items', 268, 380, 90, [], {
                          subtitle: '3 branches',
                      }),
                      card('catalog', 'catalog', 388, 366, 90, [], {
                          subtitle: '412 fields',
                      }),
                  ]
                : []),
        ],
        connections: [
            edge('order', 'customer', 'customer'),
            edge('order', 'payment', 'payment', {
                state: 'selected',
            }),
            ...(overview
                ? [
                      edge('order', 'items', 'items', {
                          id: 'items-branch-one',
                      }),
                      edge('order', 'items', 'items', {
                          id: 'items-branch-two',
                      }),
                      edge('order', 'items', 'items', {
                          id: 'items-branch-three',
                      }),
                      edge('items', 'catalog-reference', 'catalog', {
                          kind: 'reference',
                      }),
                  ]
                : []),
        ],
    };
}

function workload(
    kind: 'stress' | 'dense' | 'paged',
    requestedCount?: number,
    requestedEdges?: number
): BoardModel {
    const count =
        requestedCount ?? (kind === 'stress' ? 10000 : kind === 'dense' ? 120 : 32);
    const cards: BoardCard[] = [];
    const connections: BoardConnection[] = [];

    for (let index = 0; index < count; index += 1) {
        const id = `workload-${index}`;
        const rowCount = kind === 'dense' ? 18 : kind === 'paged' ? 50 : 8;
        const rows = Array.from(
            {
                length: rowCount,
            },
            (_, rowIndex) =>
                row(
                    `${id}-member-${rowIndex}`,
                    rowIndex % 2 === 0 ? `Поле ${rowIndex}` : `field_${rowIndex}`,
                    rowIndex % 3 === 0 ? 'integer' : 'string',
                    {
                        expandable: rowIndex === 0,
                        expanded: rowIndex === 0,
                    }
                )
        );
        const x =
            kind === 'dense'
                ? (index % 12) * 250
                : kind === 'paged'
                  ? index * 320
                  : (index % 100) * 320;
        const y =
            kind === 'dense'
                ? Math.floor(index / 12) * 600
                : kind === 'paged'
                  ? (index % 3) * 180
                  : Math.floor(index / 100) * 360;
        cards.push(
            card(
                id,
                `Структура ${index}`,
                x + 280,
                y + 80,
                248,
                rows,
                kind === 'paged'
                    ? {
                          rowWindow: {
                              firstMemberId: rows[0].memberId,
                              totalItems: 2000,
                              state: 'partial',
                              hasMore: true,
                          },
                      }
                    : {}
            )
        );

        if (index > 0) {
            connections.push(
                edge(`workload-${index - 1}`, `workload-${index - 1}-member-0`, id)
            );
        }
    }

    if (requestedEdges) {
        while (connections.length < requestedEdges) {
            const index = connections.length;
            const source = index % count;
            const target = (source + 17 + Math.floor(index / count)) % count;
            connections.push(
                edge(
                    `workload-${source}`,
                    `workload-${source}-member-0`,
                    `workload-${target}`,
                    {
                        id: `stress-edge-${index}`,
                        kind: 'reference',
                    }
                )
            );
        }
    }

    return {
        version: 1,
        state: 'ready',
        selection: null,
        cards,
        connections,
    };
}

export function getScene(id: string | null): PlaygroundScene {
    const sceneId = sceneIds.includes(id as SceneId) ? (id as SceneId) : 'main';
    const reference =
        sceneId === 'lod'
            ? references['lod-overview']
            : sceneId in references
              ? references[sceneId as keyof typeof references]
              : null;
    let board: BoardModel;

    switch (sceneId) {
        case 'main':
            board = main();
            break;
        case 'variants':
            board = variants();
            break;
        case 'replace-preview':
            board = replacePreview();
            break;
        case 'card-anatomy':
            board = anatomy();
            break;
        case 'loading':
            board = loading();
            break;
        case 'builder':
            board = builder();
            break;
        case 'lod-overview':
            board = lod('overview');
            break;
        case 'lod-working':
            board = lod('working');
            break;
        case 'lod-detailed':
            board = lod('detailed');
            break;
        case 'lod':
            board = lod('overview');
            break;
        case 'stress':
            board = workload('stress', 2000, 4000);
            break;
        case 'stress-large':
            board = workload('stress');
            break;
        default:
            board = workload(sceneId);
    }

    return {
        id: sceneId,
        title: sceneId === 'builder' ? 'Price list' : 'Orders',
        referenceFile: reference?.file ?? null,
        viewport: reference?.viewport ?? {
            width: 1440,
            height: 900,
        },
        board,
        camera: {
            x: 0,
            y: 0,
            zoom: sceneId === 'dense' ? 0.4 : 1,
        },
        shell:
            sceneId === 'main' || sceneId === 'variants'
                ? 'evidence'
                : sceneId === 'builder'
                  ? 'builder'
                  : 'none',
        crops:
            sceneId === 'lod'
                ? [
                      {
                          name: 'editor',
                          actual: {
                              x: 0,
                              y: 0,
                              width: 1560,
                              height: 640,
                          },
                          reference: {
                              x: 0,
                              y: 0,
                              width: 1560,
                              height: 640,
                          },
                      },
                      ...references['lod-overview'].crops,
                      ...references['lod-working'].crops,
                      ...references['lod-detailed'].crops,
                  ]
                : (reference?.crops ?? []),
        ...(sceneId === 'lod'
            ? {
                  panels: (
                      [
                          'overview',
                          'working',
                          'detailed',
                      ] as const
                  ).map((kind, index) => ({
                      id: kind,
                      board: lod(kind),
                      camera: {
                          x: -(48 + index * 504),
                          y: -96,
                          zoom: 1,
                      },
                      containerRect: {
                          x: 48 + index * 504,
                          y: 96,
                          width: 456,
                          height: 460,
                      },
                  })),
              }
            : {}),
    };
}

export function listScenes(): readonly PlaygroundScene[] {
    return sceneIds.map(getScene);
}
