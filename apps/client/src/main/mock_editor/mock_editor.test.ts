import { describe, expect, it } from 'vitest';
import { createMockEditorBackend } from '.';

function save(revision = 'r1', id = 'change-1', localName = 'renamed'): RequestInit {
    return {
        method: 'POST',
        headers: {
            'If-Match': JSON.stringify(`orders:${revision}`),
        },
        body: JSON.stringify({
            clientMutationId: id,
            baseRevision: revision,
            operations: [
                {
                    kind: 'renameXmlName',
                    target: {
                        kind: 'node',
                        id: 'field-name',
                    },
                    name: {
                        namespaceUri: null,
                        localName,
                    },
                },
            ],
        }),
    };
}

describe('mock editor protocol', () => {
    it('saves once, retains old revisions and persists a reopened document', async () => {
        const data = new Map<string, string>();
        const storage = {
            getItem: (key: string) => data.get(key) ?? null,
            setItem: (key: string, value: string) => {
                data.set(key, value);
            },
        };
        const backend = createMockEditorBackend(storage);
        backend.registerSchema('orders', 'Orders');
        const first = await backend.request('/api/v2/schemas/orders/changesets', save());
        expect(first?.status).toBe(201);
        expect(await first?.json()).toMatchObject({
            result: {
                revision: 'r2',
            },
        });
        const retry = await backend.request('/api/v2/schemas/orders/changesets', save());
        expect(await retry?.json()).toMatchObject({
            result: {
                revision: 'r2',
            },
        });
        const conflict = await backend.request(
            '/api/v2/schemas/orders/changesets',
            save('r1', 'change-2')
        );
        expect(conflict?.status).toBe(412);
        const reopened = createMockEditorBackend(storage);
        expect(
            await (
                await reopened.request(
                    '/api/v2/schemas/orders/revisions/r1/nodes/field-name'
                )
            )?.json()
        ).toMatchObject({
            name: {
                localName: 'name',
            },
        });
        expect(
            await (
                await reopened.request(
                    '/api/v2/schemas/orders/revisions/r2/nodes/field-name'
                )
            )?.json()
        ).toMatchObject({
            name: {
                localName: 'renamed',
            },
        });
        expect(
            await (
                await reopened.request(
                    '/api/v2/schemas/orders/revisions/r2/collections/fields/items'
                )
            )?.json()
        ).toMatchObject({
            items: [
                expect.objectContaining({
                    valueSummary: expect.objectContaining({
                        label: 'renamed',
                    }),
                }),
                expect.anything(),
                expect.anything(),
            ],
        });
    });

    it('rejects a bad batch atomically and rejects reused mutation ids with different payloads', async () => {
        const backend = createMockEditorBackend();
        backend.registerSchema('orders', 'Orders');
        const request = save();
        const body = JSON.parse(String(request.body));
        body.operations.push({
            kind: 'unsupported',
        });
        expect(
            (
                await backend.request('/api/v2/schemas/orders/changesets', {
                    ...request,
                    body: JSON.stringify(body),
                })
            )?.status
        ).toBe(422);
        expect(await (await backend.request('/api/v2/schemas/orders'))?.json()).toEqual({
            id: 'orders',
            revision: 'r1',
        });
        await backend.request('/api/v2/schemas/orders/changesets', save());
        expect(
            (
                await backend.request(
                    '/api/v2/schemas/orders/changesets',
                    save('r1', 'change-1', 'different')
                )
            )?.status
        ).toBe(409);
    });

    it('creates an idempotent draft only from a known analysis and honours read cancellation', async () => {
        const backend = createMockEditorBackend();
        const body = JSON.stringify({
            source: {
                analysisId: 'a1',
                revision: 'a1-r1',
                seedId: 'mock-seed',
                rootAlternativeId: 'mock-root',
            },
        });
        expect(
            (
                await backend.request('/api/v2/schemas', {
                    method: 'POST',
                    body,
                })
            )?.status
        ).toBe(404);
        backend.registerAnalysis('a1', 'a1-r1', 'Uploaded documents');
        const first = await (
            await backend.request('/api/v2/schemas', {
                method: 'POST',
                body,
            })
        )?.json();
        const second = await (
            await backend.request('/api/v2/schemas', {
                method: 'POST',
                body,
            })
        )?.json();
        expect(first).toEqual(second);
        expect(first.snapshot.id).toBe('draft-a1');
        const controller = new AbortController();
        controller.abort();
        await expect(
            backend.request('/api/v2/schemas/orders', {
                signal: controller.signal,
            })
        ).rejects.toMatchObject({
            name: 'AbortError',
        });
    });
});
