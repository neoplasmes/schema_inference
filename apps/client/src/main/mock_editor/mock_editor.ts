type Node = {
    id: string;
    kind: string;
    [key: string]: unknown;
};
type Row = {
    member: {
        id: string;
        kind: string;
        valueNodeId: string;
        [key: string]: unknown;
    };
    valueSummary: {
        id: string;
        kind: string;
        label: string;
        directMemberCount: number;
        descendantCount: number | null;
    };
};
type Revision = {
    title: string;
    nodes: Record<string, Node>;
    collections: Record<string, Row[]>;
};
type Receipt = {
    id: string;
    clientMutationId: string;
    status: 'applied';
    result: {
        revision: string;
    };
};
type Schema = {
    current: string;
    revisions: Record<string, Revision>;
    receipts: Record<
        string,
        {
            payload: string;
            receipt: Receipt;
        }
    >;
};
type State = {
    schemas: Record<string, Schema>;
    analyses: Record<
        string,
        {
            revision: string;
            title: string;
        }
    >;
};

export type MockEditorBackend = {
    request(path: string, options?: RequestInit): Promise<Response | null>;
    registerSchema(id: string, title: string): void;
    registerAnalysis(id: string, revision: string, title: string): void;
};

const storageKey = 'schema-workspace.editor.v1';

function response(value: unknown, status = 200): Response {
    return new Response(JSON.stringify(value), {
        status,
        headers: {
            'Content-Type': 'application/json',
        },
    });
}

function seed(title: string): Revision {
    const nodes: Record<string, Node> = {
        root: {
            id: 'root',
            kind: 'xmlElement',
            name: {
                namespaceUri: null,
                localName: 'document',
            },
            contentNodeId: 'complex',
            nillable: false,
        },
        complex: {
            id: 'complex',
            kind: 'xmlComplex',
            attributes: {
                id: 'attributes',
                totalItems: 0,
            },
            particleNodeId: 'group',
            mixed: false,
        },
        group: {
            id: 'group',
            kind: 'xmlGroup',
            compositor: 'sequence',
            particles: {
                id: 'fields',
                totalItems: 3,
            },
        },
    };
    const fields = [
        'name',
        'amount',
        'status',
    ].map(name => {
        const id = `field-${name}`;
        nodes[id] = {
            id,
            kind: 'xmlElement',
            name: {
                namespaceUri: null,
                localName: name,
            },
            contentNodeId: `${id}-value`,
            nillable: false,
        };
        nodes[`${id}-value`] = {
            id: `${id}-value`,
            kind: 'scalar',
            scalarType: name === 'amount' ? 'decimal' : 'string',
            constraints: {},
        };

        return {
            member: {
                id: `member-${name}`,
                kind: 'xmlParticle',
                valueNodeId: id,
                minOccurs: 1,
                maxOccurs: 1,
            },
            valueSummary: {
                id,
                kind: 'xmlElement',
                label: name,
                directMemberCount: 0,
                descendantCount: 0,
            },
        };
    });

    return {
        title,
        nodes,
        collections: {
            attributes: [],
            fields,
        },
    };
}

function manifest(id: string, revision: string, data: Revision) {
    return {
        contractVersion: 2,
        format: 'schema-draft',
        snapshot: {
            resource: 'schema',
            id,
            revision,
        },
        title: data.title,
        profile: {
            syntax: 'xml',
            dialect: 'xsd-1.0',
        },
        rootNodeId: 'root',
    };
}

function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Expected an object.');
    }

    return value as Record<string, unknown>;
}

/** Stores mock protocol snapshots independently from either microfrontend's cache. */
export function createMockEditorBackend(
    storage?: Pick<Storage, 'getItem' | 'setItem'>
): MockEditorBackend {
    let state: State = {
        schemas: {},
        analyses: {},
    };
    const saved = storage?.getItem(storageKey);

    if (saved) {
        try {
            const parsed = object(JSON.parse(saved));
            object(parsed.schemas);
            object(parsed.analyses);
            state = parsed as State;
        } catch {
            state = {
                schemas: {},
                analyses: {},
            };
        }
    }

    const persist = () => storage?.setItem(storageKey, JSON.stringify(state));
    const registerSchema = (id: string, title: string) => {
        if (!Object.hasOwn(state.schemas, id)) {
            state.schemas[id] = {
                current: 'r1',
                revisions: {
                    r1: seed(title),
                },
                receipts: {},
            };
            persist();
        }
    };

    return {
        registerSchema,
        registerAnalysis(id, revision, title) {
            state.analyses[id] = {
                revision,
                title,
            };
            persist();
        },
        async request(path, options) {
            options?.signal?.throwIfAborted();
            const url = new URL(path, 'http://mock.local');
            const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);

            if (parts[0] !== 'api' || parts[1] !== 'v2') {
                return null;
            }

            const method = options?.method ?? 'GET';

            try {
                if (parts[2] !== 'schemas') {
                    return response(
                        {
                            error: 'Mock route not found.',
                        },
                        404
                    );
                }

                const id = parts[3];
                const schema = Object.hasOwn(state.schemas, id)
                    ? state.schemas[id]
                    : undefined;

                if (!schema) {
                    return response(
                        {
                            error: 'Schema not found.',
                        },
                        404
                    );
                }

                if (parts.length === 4 && method === 'GET') {
                    return response({
                        id,
                        revision: schema.current,
                    });
                }

                const revision = parts[5];
                const data = Object.hasOwn(schema.revisions, revision)
                    ? schema.revisions[revision]
                    : undefined;

                if (parts[4] !== 'revisions' || !data || method !== 'GET') {
                    return response(
                        {
                            error: 'Revision not found.',
                        },
                        404
                    );
                }

                if (parts[6] === 'manifest') {
                    return response(manifest(id, revision, data));
                }

                if (parts[6] === 'nodes') {
                    return Object.hasOwn(data.nodes, parts[7])
                        ? response(data.nodes[parts[7]])
                        : response(
                              {
                                  error: 'Node not found.',
                              },
                              404
                          );
                }

                if (parts[6] === 'collections' && parts[8] === 'items') {
                    const rows = Object.hasOwn(data.collections, parts[7])
                        ? data.collections[parts[7]]
                        : undefined;
                    const offset = Number(url.searchParams.get('cursor') ?? 0);

                    if (
                        !rows ||
                        !Number.isSafeInteger(offset) ||
                        offset < 0 ||
                        offset > rows.length
                    ) {
                        return response(
                            {
                                error: 'Page not found.',
                            },
                            404
                        );
                    }

                    return response({
                        contractVersion: 2,
                        snapshot: {
                            resource: 'schema',
                            id,
                            revision,
                        },
                        collectionId: parts[7],
                        scopeId: null,
                        items: rows.slice(offset, offset + 50),
                        totalItems: rows.length,
                        nextCursor:
                            offset + 50 < rows.length ? String(offset + 50) : null,
                    });
                }

                return response(
                    {
                        error: 'Mock route not found.',
                    },
                    404
                );
            } catch (error) {
                return response(
                    {
                        error:
                            error instanceof Error ? error.message : 'Invalid request.',
                    },
                    422
                );
            }
        },
    };
}
