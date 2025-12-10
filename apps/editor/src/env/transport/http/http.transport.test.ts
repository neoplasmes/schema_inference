import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpResponseError, HttpTransport } from '.';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('editor HTTP transport authentication', () => {
    it('sends cookies and reports 401 responses to the host', async () => {
        const fetch = vi.fn<typeof globalThis.fetch>(
            async () =>
                new Response('{}', {
                    status: 401,
                })
        );
        vi.stubGlobal('fetch', fetch);
        const onUnauthenticated = vi.fn();

        await expect(
            new HttpTransport('https://api.example.test', onUnauthenticated).request(
                '/api/v2/schemas/orders'
            )
        ).rejects.toBeInstanceOf(HttpResponseError);
        expect(fetch).toHaveBeenCalledWith(
            'https://api.example.test/api/v2/schemas/orders',
            expect.objectContaining({
                credentials: 'include',
            })
        );
        expect(onUnauthenticated).toHaveBeenCalledTimes(1);
    });

    it('does not report other failures', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response('{}', {
                        status: 500,
                    })
            )
        );
        const onUnauthenticated = vi.fn();

        await expect(
            new HttpTransport('', onUnauthenticated).request('/x')
        ).rejects.toBeInstanceOf(HttpResponseError);
        expect(onUnauthenticated).not.toHaveBeenCalled();
    });
});
