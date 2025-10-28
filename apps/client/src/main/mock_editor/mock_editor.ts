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
    updatedAt: string;
    documentCount: number;
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
    drafts: Record<
        string,
        {
            payload: string;
            schemaId: string;
        }
    >;
    analyses: Record<
        string,
        {
            revision: string;
            title: string;
            documentCount: number;
        }
    >;
};

export type MockEditorBackend = {
    request(path: string, options?: RequestInit): Promise<Response | null>;
    registerSchema(
        id: string,
        title: string,
        metadata?: {
            documentCount: number;
            updatedAt: string;
        }
    ): void;
    registerAnalysis(
        id: string,
        revision: string,
        title: string,
        documentCount?: number
    ): void;
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

function text(value: unknown): string {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error('Expected a non-empty string.');
    }

    return value;
}

function apply(data: Revision, operations: unknown): void {
    if (!Array.isArray(operations)) {
        throw new Error('Expected operations.');
    }

    for (const value of operations) {
        const operation = object(value);
        const rows = Object.values(data.collections).flat();

        if (operation.kind === 'renameXmlName') {
            const target = object(operation.target);
            const id = text(target.id);
            const name = object(operation.name);
            const localName = text(name.localName);

            if (
                !/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(localName) ||
                (name.namespaceUri !== null && typeof name.namespaceUri !== 'string')
            ) {
                throw new Error('Invalid XML name.');
            }

            if (target.kind === 'node') {
                const node = data.nodes[id];

                if (node?.kind !== 'xmlElement') {
                    throw new Error('XML element not found.');
                }

                node.name = {
                    namespaceUri: name.namespaceUri,
                    localName,
                };

                for (const row of rows.filter(row => row.valueSummary.id === id)) {
                    row.valueSummary.label = localName;
                }
            } else if (target.kind === 'member') {
                const row = rows.find(row => row.member.id === id);

                if (row?.member.kind !== 'xmlAttribute') {
                    throw new Error('XML attribute not found.');
                }

                row.member.name = {
                    namespaceUri: name.namespaceUri,
                    localName,
                };
            } else {
                throw new Error('Invalid rename target.');
            }
        } else if (operation.kind === 'renameProperty') {
            const row = rows.find(row => row.member.id === operation.memberId);

            if (row?.member.kind !== 'property') {
                throw new Error('Property not found.');
            }

            row.member.name = text(operation.name);
        } else if (operation.kind === 'moveMember') {
            const source = Object.values(data.collections).find(rows =>
                rows.some(row => row.member.id === operation.memberId)
            );
            const target = data.collections[text(operation.targetCollectionId)];

            if (!source || !target) {
                throw new Error('Collection or member not found.');
            }

            const index = source.findIndex(row => row.member.id === operation.memberId);
            const row = source[index];

            if (operation.beforeMemberId === row.member.id) {
                continue;
            }

            if (
                operation.beforeMemberId !== null &&
                !target.some(row => row.member.id === operation.beforeMemberId)
            ) {
                throw new Error('Target position not found.');
            }

            if (target !== source) {
                throw new Error('This mock supports ordering within one collection.');
            }

            source.splice(index, 1);
            target.splice(
                operation.beforeMemberId === null
                    ? target.length
                    : target.findIndex(row => row.member.id === operation.beforeMemberId),
                0,
                row
            );
        } else {
            throw new Error('Unsupported operation.');
        }
    }
}

function summary(id: string, schema: Schema) {
    return {
        id,
        title: schema.revisions[schema.current].title,
        revision: schema.current,
        updated_at: schema.updatedAt ?? '2025-10-19T09:24:48Z',
        document_count: schema.documentCount ?? 1,
    };
}

/** Stores mock protocol snapshots independently from either microfrontend's cache. */
export function createMockEditorBackend(
    storage?: Pick<Storage, 'getItem' | 'setItem'>
): MockEditorBackend {
    let state: State = {
        schemas: {},
        analyses: {},
        drafts: {},
    };
    const saved = storage?.getItem(storageKey);

    if (saved) {
        try {
            const parsed = object(JSON.parse(saved));
            object(parsed.schemas);
            object(parsed.analyses);
            state = {
                ...parsed,
                drafts: parsed.drafts ?? {},
            } as State;
        } catch {
            state = {
                schemas: {},
                analyses: {},
                drafts: {},
            };
        }
    }

    const persist = () => storage?.setItem(storageKey, JSON.stringify(state));
    const addSchema: MockEditorBackend['registerSchema'] = (id, title, metadata) => {
        if (!Object.hasOwn(state.schemas, id)) {
            state.schemas[id] = {
                updatedAt: metadata?.updatedAt ?? new Date().toISOString(),
                documentCount: metadata?.documentCount ?? 1,
                current: 'r1',
                revisions: {
                    r1: seed(title),
                },
                receipts: {},
            };
        }
    };

    return {
        registerSchema(id, title, metadata) {
            addSchema(id, title, metadata);
            persist();
        },
        registerAnalysis(id, revision, title, documentCount = 1) {
            state.analyses[id] = {
                revision,
                title,
                documentCount,
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
                if (
                    parts[2] === 'analyses' &&
                    parts[4] === 'revisions' &&
                    parts[6] === 'manifest' &&
                    method === 'GET'
                ) {
                    const analysis = Object.hasOwn(state.analyses, parts[3])
                        ? state.analyses[parts[3]]
                        : undefined;

                    return analysis?.revision === parts[5]
                        ? response({
                              contractVersion: 2,
                              format: 'schema-analysis',
                              title: analysis.title,
                              snapshot: {
                                  resource: 'analysis',
                                  id: parts[3],
                                  revision: parts[5],
                              },
                              suggestedDraft: {
                                  seedId: 'mock-seed',
                                  suggestedRootAlternativeId: 'mock-root',
                              },
                          })
                        : response(
                              {
                                  error: 'Analysis not found.',
                              },
                              404
                          );
                }

                if (parts[2] !== 'schemas') {
                    return response(
                        {
                            error: 'Mock route not found.',
                        },
                        404
                    );
                }

                if (parts.length === 3 && method === 'GET') {
                    return response(
                        Object.entries(state.schemas)
                            .map(([id, schema]) => summary(id, schema))
                            .sort((left, right) =>
                                right.updated_at.localeCompare(left.updated_at)
                            )
                    );
                }

                if (parts.length === 3 && method === 'POST') {
                    const key = new Headers(options?.headers).get('Idempotency-Key');

                    if (!key) {
                        return response(
                            {
                                error: 'idempotency_key_required',
                            },
                            400
                        );
                    }

                    const body = object(JSON.parse(String(options?.body)));
                    const payload = JSON.stringify(body);
                    const previous = Object.hasOwn(state.drafts, key)
                        ? state.drafts[key]
                        : undefined;

                    if (previous) {
                        return previous.payload === payload
                            ? response(
                                  manifest(
                                      previous.schemaId,
                                      'r1',
                                      state.schemas[previous.schemaId].revisions.r1
                                  )
                              )
                            : response(
                                  {
                                      error: 'idempotency_key_reused',
                                  },
                                  409
                              );
                    }
                    const source = object(body.source);
                    const analysisId = text(source.analysisId);
                    const analysis = Object.hasOwn(state.analyses, analysisId)
                        ? state.analyses[analysisId]
                        : undefined;

                    if (
                        !analysis ||
                        analysis.revision !== source.revision ||
                        source.seedId !== 'mock-seed' ||
                        source.rootAlternativeId !== 'mock-root'
                    ) {
                        return response(
                            {
                                error: 'Analysis not found.',
                            },
                            404
                        );
                    }

                    const id = `draft-${crypto.randomUUID()}`;
                    addSchema(id, text(body.title), {
                        documentCount: analysis.documentCount ?? 1,
                        updatedAt: new Date().toISOString(),
                    });
                    state.drafts[key] = {
                        payload,
                        schemaId: id,
                    };
                    persist();
                    const schema = state.schemas[id];

                    return response(
                        manifest(id, schema.current, schema.revisions[schema.current]),
                        201
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
                    return response(summary(id, schema));
                }

                if (parts[4] === 'changesets' && method === 'POST') {
                    const body = object(JSON.parse(String(options?.body)));
                    const mutation = text(body.clientMutationId);
                    const payload = JSON.stringify(body);
                    const existing = Object.hasOwn(schema.receipts, mutation)
                        ? schema.receipts[mutation]
                        : undefined;

                    if (existing) {
                        return existing.payload === payload
                            ? response(existing.receipt)
                            : response(
                                  {
                                      error: 'Idempotency key reused.',
                                  },
                                  409
                              );
                    }

                    if (!new Headers(options?.headers).has('If-Match')) {
                        return response(
                            {
                                error: 'precondition_required',
                            },
                            428
                        );
                    }

                    if (
                        body.baseRevision !== schema.current ||
                        new Headers(options?.headers).get('If-Match') !==
                            JSON.stringify(`${id}:${schema.current}`)
                    ) {
                        return response(
                            {
                                error: 'Revision conflict.',
                            },
                            412
                        );
                    }

                    const data = structuredClone(schema.revisions[schema.current]);
                    apply(data, body.operations);
                    const revision = `r${Object.keys(schema.revisions).length + 1}`;
                    const receipt: Receipt = {
                        id: mutation,
                        clientMutationId: mutation,
                        status: 'applied',
                        result: {
                            revision,
                        },
                    };
                    schema.current = revision;
                    schema.updatedAt = new Date().toISOString();
                    schema.revisions[revision] = data;
                    schema.receipts[mutation] = {
                        payload,
                        receipt,
                    };
                    persist();

                    return response(receipt, 201);
                }

                if (parts[4] === 'changesets' && parts[5] && method === 'GET') {
                    const receipt = Object.hasOwn(schema.receipts, parts[5])
                        ? schema.receipts[parts[5]]
                        : undefined;

                    return receipt
                        ? response(receipt.receipt)
                        : response(
                              {
                                  error: 'Changeset not found.',
                              },
                              404
                          );
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
