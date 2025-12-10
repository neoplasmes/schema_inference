import { afterEach, describe, expect, it, vi } from 'vitest';
import { FetchHttpTransport } from '.';
import type { HttpError } from '.';

afterEach(() => vi.unstubAllGlobals());

describe('fetch HTTP transport', () => {
    it('uses the configured server and preserves cancellation and request headers', async () => {
        const controller = new AbortController();
        const fetch = vi.fn<typeof globalThis.fetch>(async () =>
            Response.json({
                id: 'analysis-1',
            })
        );
        vi.stubGlobal('fetch', fetch);
        const transport = new FetchHttpTransport('https://api.example.test/');

        expect(
            await transport.request('/api/v2/analyses', {
                method: 'POST',
                signal: controller.signal,
                headers: new Headers({
                    'Idempotency-Key': 'upload-1',
                }),
                body: '{}',
            })
        ).toEqual({
            id: 'analysis-1',
        });
        expect(fetch).toHaveBeenCalledWith(
            'https://api.example.test/api/v2/analyses',
            expect.objectContaining({
                signal: controller.signal,
                method: 'POST',
                body: '{}',
            })
        );
        const headers = new Headers(fetch.mock.calls[0][1]?.headers);
        expect(headers.get('Idempotency-Key')).toBe('upload-1');
        expect(headers.get('Content-Type')).toBe('application/json');
    });

    it('preserves HTTP status when the server returns a non-JSON failure', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response('Gateway unavailable', {
                        status: 503,
                    })
            )
        );

        await expect(
            new FetchHttpTransport('').request('/api/v2/schemas')
        ).rejects.toMatchObject({
            status: 503,
            body: 'Gateway unavailable',
        } satisfies Partial<HttpError>);
    });
});

describe('fetch HTTP transport credentials and interceptors', () => {
    it('sends cookies with every request', async () => {
        const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({}));
        vi.stubGlobal('fetch', fetch);

        await new FetchHttpTransport('https://api.example.test').request(
            '/api/v2/session'
        );

        expect(fetch).toHaveBeenCalledWith(
            'https://api.example.test/api/v2/session',
            expect.objectContaining({
                credentials: 'include',
            })
        );
    });

    it('notifies error interceptors before rejecting', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response('{"code":"unauthenticated"}', {
                        status: 401,
                    })
            )
        );
        const interceptor = vi.fn();
        const transport = new FetchHttpTransport('');
        transport.addErrorInterceptor(interceptor);

        await expect(transport.request('/api/v2/schemas')).rejects.toMatchObject({
            status: 401,
        });
        expect(interceptor).toHaveBeenCalledWith(
            expect.objectContaining({
                status: 401,
            })
        );
    });
});
