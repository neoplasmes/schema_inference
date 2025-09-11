import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockWorkspaceBackend } from '.';

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
        const created = backend.request('/api/workspace/analyses', upload);
        await vi.runAllTimersAsync();
        const first = await (await created).json();
        const retry = backend.request('/api/workspace/analyses', upload);
        await vi.runAllTimersAsync();

        expect((await (await retry).json()).id).toBe(first.id);
        expect(remote.registerAnalysis).toHaveBeenCalledTimes(1);
        expect(remote.registerAnalysis).toHaveBeenCalledWith(
            first.id,
            'analysis-1',
            'Catalog'
        );
        expect(first.documents[0].content).toBe('{}');
        await vi.advanceTimersByTimeAsync(2000);
        const read = backend.request(`/api/workspace/analyses/${first.id}`);
        await vi.runAllTimersAsync();

        expect(await (await read).json()).toMatchObject({
            status: 'completed',
            progress: 100,
        });
    });

    it('persists save metadata and restores registrations without a server', async () => {
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
            clear: () => {
                values.clear();
            },
            key: index =>
                [
                    ...values.keys(),
                ][index] ?? null,
        };
        const backend = new MockWorkspaceBackend(editor(), storage);
        const save = backend.request('/api/workspace/schemas/new-schema', {
            method: 'PUT',
            body: JSON.stringify({
                title: 'New schema',
                revision: 'r2',
                saved_at: '2025-08-21T10:00:00Z',
                document_count: 4,
            }),
        });
        await vi.runAllTimersAsync();
        expect((await save).status).toBe(200);
        const remote = editor();
        const restored = new MockWorkspaceBackend(remote, storage);
        const list = restored.request('/api/workspace/schemas');
        await vi.runAllTimersAsync();

        expect((await (await list).json())[0]).toMatchObject({
            id: 'new-schema',
            title: 'New schema',
            revision: 'r2',
            document_count: 4,
        });
        expect(remote.registerSchema).toHaveBeenCalledWith('new-schema', 'New schema');
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
