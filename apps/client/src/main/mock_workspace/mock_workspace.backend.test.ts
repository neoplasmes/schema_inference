import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockWorkspaceBackend } from '.';
import { createMockEditorBackend } from '../mock_editor';

const editor = () => ({
    request: vi.fn(async () => null),
    registerSchema: vi.fn(),
    registerAnalysis: vi.fn(),
});
const upload: RequestInit = {
    method: 'POST',
    headers: {
        'Idempotency-Key': 'attempt-1',
    },
    body: JSON.stringify({
        title: 'Catalog',
        documents: [
            {
                name: 'catalog.json',
                format: 'json',
                size: 2,
                content: '{}',
            },
        ],
    }),
};

afterEach(() => vi.useRealTimers());

describe('mock workspace flow', () => {
    it('replays upload retries and polls a completed analysis registered in the editor', async () => {
        vi.useFakeTimers();
        const remote = editor();
        const backend = new MockWorkspaceBackend(remote);
        const created = backend.request('/api/v2/analyses', upload);
        await vi.runAllTimersAsync();
        const first = await (await created).json();
        const retry = backend.request('/api/v2/analyses', upload);
        await vi.runAllTimersAsync();

        expect((await (await retry).json()).id).toBe(first.id);
        expect(remote.registerAnalysis).toHaveBeenCalledTimes(1);
        expect(remote.registerAnalysis).toHaveBeenCalledWith(
            first.id,
            'analysis-1',
            'Catalog',
            1
        );
        expect(first.documents[0]).not.toHaveProperty('content');
        await vi.advanceTimersByTimeAsync(2000);
        const read = backend.request(`/api/v2/analyses/${first.id}`);
        await vi.runAllTimersAsync();

        expect(await (await read).json()).toMatchObject({
            status: 'completed',
            progress: 100,
        });
    });

    it('rejects reusing an upload identity for different source documents', async () => {
        vi.useFakeTimers();
        const backend = new MockWorkspaceBackend(createMockEditorBackend());
        const created = backend.request('/api/v2/analyses', upload);
        await vi.runAllTimersAsync();
        expect((await created).status).toBe(202);
        const changed = backend.request('/api/v2/analyses', {
            ...upload,
            body: JSON.stringify({
                title: 'Other',
                documents: [
                    {
                        name: 'catalog.json',
                        format: 'json',
                        size: 2,
                        content: '[]',
                    },
                ],
            }),
        });
        await vi.runAllTimersAsync();

        expect((await changed).status).toBe(409);
    });

    it('reads committed editor metadata through the shared namespace after reopening', async () => {
        vi.useFakeTimers();
        const values = new Map<string, string>();
        const storage: Storage = {
            get length() {
                return values.size;
            },
            getItem: key => values.get(key) ?? null,
            setItem: (key, value) => {
                values.set(key, value);
            },
            removeItem: key => {
                values.delete(key);
            },
            clear: () => values.clear(),
            key: index =>
                [
                    ...values.keys(),
                ][index] ?? null,
        };
        const backend = new MockWorkspaceBackend(
            createMockEditorBackend(storage),
            storage
        );
        const pending = backend.request('/api/v2/schemas/orders/changesets', {
            method: 'POST',
            headers: {
                'If-Match': '"orders:r1"',
            },
            body: JSON.stringify({
                clientMutationId: 'save-1',
                baseRevision: 'r1',
                operations: [],
            }),
        });
        await vi.runAllTimersAsync();
        expect((await pending).status).toBe(201);
        const restored = new MockWorkspaceBackend(
            createMockEditorBackend(storage),
            storage
        );
        const listing = restored.request('/api/v2/schemas');
        const detail = restored.request('/api/v2/schemas/orders');
        await vi.runAllTimersAsync();
        const summary = await (await detail).json();

        expect(summary).toMatchObject({
            id: 'orders',
            revision: 'r2',
            title: 'Customer orders',
            document_count: 2,
        });
        expect(await (await listing).json()).toContainEqual(summary);
        const invalid = restored.request('/api/v2/schemas/orders', {
            method: 'PUT',
            body: '{}',
        });
        await vi.runAllTimersAsync();
        expect((await invalid).ok).toBe(false);
    });

    it('cancels pending reads before dispatching to a handler', async () => {
        vi.useFakeTimers();
        const remote = editor();
        const controller = new AbortController();
        const pending = new MockWorkspaceBackend(remote).request(
            '/api/v2/schemas/missing',
            {
                signal: controller.signal,
            }
        );
        controller.abort();

        await expect(pending).rejects.toMatchObject({
            name: 'AbortError',
        });
        expect(remote.request).not.toHaveBeenCalled();
    });
});
