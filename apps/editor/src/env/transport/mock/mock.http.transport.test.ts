import { describe, expect, it, vi } from 'vitest';
import { MockHttpTransport } from '.';
import { HttpResponseError } from '../http';

describe('mock HTTP transport', () => {
    it('uses the same protocol error boundary as HTTP', async () => {
        const transport = new MockHttpTransport(
            async () =>
                new Response(null, {
                    status: 412,
                })
        );
        await expect(transport.request('/resource')).rejects.toBeInstanceOf(
            HttpResponseError
        );
        await expect(transport.request('/resource')).rejects.toMatchObject({
            status: 412,
        });
    });

    it('rejects an aborted read even when its handler returns late', async () => {
        let complete!: (response: Response) => void;
        const handler = vi.fn(
            () =>
                new Promise<Response>(resolve => {
                    complete = resolve;
                })
        );
        const transport = new MockHttpTransport(handler);
        const controller = new AbortController();
        const pending = transport.request('/resource', {
            signal: controller.signal,
        });
        controller.abort();
        complete(new Response('{}'));
        await expect(pending).rejects.toMatchObject({
            name: 'AbortError',
        });
        await expect(
            transport.request('/resource', {
                signal: controller.signal,
            })
        ).rejects.toMatchObject({
            name: 'AbortError',
        });
        expect(handler).toHaveBeenCalledTimes(1);
    });
});
