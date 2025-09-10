import type { HttpRequestHandler } from '../../env/transport';

interface MockEditorBackend {
    request(path: string, options?: RequestInit): Promise<Response | null>;
    registerAnalysis(id: string, revision: string, title: string): void;
    registerSchema(id: string, title: string): void;
}

interface SchemaRecord {
    id: string;
    title: string;
    revision: string;
    updated_at: string;
    document_count: number;
}

interface DocumentRecord {
    id: string;
    name: string;
    format: 'xml' | 'yaml' | 'json';
    size: number;
    content: string;
}

interface AnalysisRecord {
    id: string;
    title: string;
    revision: string;
    documents: DocumentRecord[];
    created_at: string;
    status: 'queued' | 'processing' | 'completed';
    progress: number;
    error: null;
}

interface WorkspaceSnapshot {
    schemas: SchemaRecord[];
    analyses: AnalysisRecord[];
    attempts: Record<string, string>;
}

const storageKey = 'schema-workspace.host.v1';

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'Content-Type': 'application/json',
        },
    });
}

function wait(signal?: AbortSignal | null): Promise<void> {
    return new Promise((resolve, reject) => {
        signal?.throwIfAborted();
        const onAbort = () => {
            clearTimeout(timer);
            reject(signal?.reason);
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, 160);
        signal?.addEventListener('abort', onAbort, {
            once: true,
        });
    });
}

function initialSnapshot(): WorkspaceSnapshot {
    return {
        schemas: [
            {
                id: 'catalog',
                title: 'Product catalog',
                revision: 'r1',
                updated_at: '2025-08-03T10:00:00.000Z',
                document_count: 3,
            },
            {
                id: 'orders',
                title: 'Customer orders',
                revision: 'r1',
                updated_at: '2025-08-02T15:30:00.000Z',
                document_count: 2,
            },
        ],
        analyses: [],
        attempts: {},
    };
}

export class MockWorkspaceBackend {
    private readonly snapshot: WorkspaceSnapshot;

    constructor(
        private readonly editor: MockEditorBackend,
        private readonly storage?: Storage
    ) {
        this.snapshot = this.restore();

        for (const schema of this.snapshot.schemas) {
            this.editor.registerSchema(schema.id, schema.title);
        }

        for (const analysis of this.snapshot.analyses) {
            this.editor.registerAnalysis(analysis.id, analysis.revision, analysis.title);
        }
    }

    readonly request: HttpRequestHandler = async (path, options = {}) => {
        await wait(options.signal);
        const method = options.method ?? 'GET';
        const route = path.split('?')[0];

        if (route === '/api/workspace/schemas' && method === 'GET') {
            return json(
                [
                    ...this.snapshot.schemas,
                ].sort((left, right) => right.updated_at.localeCompare(left.updated_at))
            );
        }

        if (route.startsWith('/api/workspace/schemas/')) {
            const id = decodeURIComponent(route.slice('/api/workspace/schemas/'.length));

            if (method === 'GET') {
                const schema = this.snapshot.schemas.find(item => item.id === id);

                return schema
                    ? json(schema)
                    : json(
                          {
                              error: 'schema_not_found',
                          },
                          404
                      );
            }

            if (method === 'PUT') {
                return this.recordSaved(id, options);
            }
        }

        if (route === '/api/workspace/analyses' && method === 'POST') {
            return this.createAnalysis(options);
        }

        if (route.startsWith('/api/workspace/analyses/') && method === 'GET') {
            const id = decodeURIComponent(route.slice('/api/workspace/analyses/'.length));
            const analysis = this.snapshot.analyses.find(item => item.id === id);

            if (!analysis) {
                return json(
                    {
                        error: 'analysis_not_found',
                    },
                    404
                );
            }

            return json(this.currentAnalysis(analysis));
        }

        return (
            (await this.editor.request(path, options)) ??
            json(
                {
                    error: 'not_found',
                },
                404
            )
        );
    };

    private createAnalysis(options: RequestInit): Response {
        const key = new Headers(options.headers).get('Idempotency-Key');

        if (!key) {
            return json(
                {
                    error: 'idempotency_key_required',
                },
                400
            );
        }

        const previousId = this.snapshot.attempts[key];
        const previous = this.snapshot.analyses.find(item => item.id === previousId);

        if (previous) {
            return json(this.currentAnalysis(previous));
        }

        const body: unknown = JSON.parse(String(options.body ?? '{}'));

        if (
            !body ||
            typeof body !== 'object' ||
            !('title' in body) ||
            typeof body.title !== 'string' ||
            !('documents' in body) ||
            !Array.isArray(body.documents) ||
            body.documents.length === 0
        ) {
            return json(
                {
                    error: 'invalid_documents',
                },
                422
            );
        }

        if (
            body.documents.some(
                document =>
                    !document ||
                    typeof document.name !== 'string' ||
                    typeof document.content !== 'string' ||
                    ![
                        'xml',
                        'yaml',
                        'json',
                    ].includes(document.format)
            )
        ) {
            return json(
                {
                    error: 'invalid_document',
                },
                422
            );
        }

        const id = `analysis-${crypto.randomUUID()}`;
        const analysis: AnalysisRecord = {
            id,
            title: body.title,
            revision: 'analysis-1',
            created_at: new Date().toISOString(),
            status: 'queued',
            progress: 0,
            documents: body.documents.map((document, index) => ({
                ...document,
                id: `${id}-document-${index + 1}`,
            })),
            error: null,
        };
        this.editor.registerAnalysis(id, analysis.revision, analysis.title);
        this.snapshot.analyses.push(analysis);
        this.snapshot.attempts[key] = id;
        this.persist();

        return json(analysis, 201);
    }

    private currentAnalysis(analysis: AnalysisRecord): AnalysisRecord {
        const elapsed = Date.now() - Date.parse(analysis.created_at);
        const progress = Math.min(100, Math.max(0, Math.floor(elapsed / 18)));

        return {
            ...analysis,
            progress,
            status:
                progress === 100 ? 'completed' : progress > 15 ? 'processing' : 'queued',
        };
    }

    private recordSaved(id: string, options: RequestInit): Response {
        const body = JSON.parse(String(options.body ?? '{}')) as Record<string, unknown>;

        if (typeof body.revision !== 'string' || typeof body.saved_at !== 'string') {
            return json(
                {
                    error: 'invalid_schema',
                },
                422
            );
        }

        const existing = this.snapshot.schemas.find(schema => schema.id === id);
        const schema: SchemaRecord = {
            id,
            revision: body.revision,
            updated_at: body.saved_at,
            title:
                typeof body.title === 'string' && body.title
                    ? body.title
                    : (existing?.title ?? 'Untitled schema'),
            document_count:
                typeof body.document_count === 'number'
                    ? body.document_count
                    : (existing?.document_count ?? 1),
        };
        this.snapshot.schemas = [
            schema,
            ...this.snapshot.schemas.filter(item => item.id !== id),
        ];
        this.persist();

        return json(schema);
    }

    private restore(): WorkspaceSnapshot {
        try {
            const saved = this.storage?.getItem(storageKey);

            if (saved) {
                const value = JSON.parse(saved) as WorkspaceSnapshot;

                if (
                    Array.isArray(value.schemas) &&
                    Array.isArray(value.analyses) &&
                    value.attempts &&
                    typeof value.attempts === 'object'
                ) {
                    return value;
                }
            }
        } catch {
            return initialSnapshot();
        }

        return initialSnapshot();
    }

    private persist(): void {
        this.storage?.setItem(storageKey, JSON.stringify(this.snapshot));
    }
}
