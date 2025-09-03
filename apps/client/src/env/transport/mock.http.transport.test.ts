import { describe, expect, it, vi } from 'vitest';
import { HttpError, MockHttpTransport } from '.';

describe('mock protocol transport', () => {
    it('does not invoke a handler for an already cancelled read', async () => {
        const controller = new AbortController();
        controller.abort();
        const handler = vi.fn(async () => Response.json({}));

        await expect(
            new MockHttpTransport(handler).request('/anything', {
                signal: controller.signal,
            })
        ).rejects.toMatchObject({
            name: 'AbortError',
        });
        expect(handler).not.toHaveBeenCalled();
    });

    it('does not deliver a late response after cancellation', async () => {
        const controller = new AbortController();
        const transport = new MockHttpTransport(async () => {
            controller.abort();

            return Response.json({
                value: 'late',
            });
        });

        await expect(
            transport.request('/anything', {
                signal: controller.signal,
            })
        ).rejects.toMatchObject({
            name: 'AbortError',
        });
    });

    it('keeps protocol error status and body available to repositories', async () => {
        const transport = new MockHttpTransport(async () =>
            Response.json(
                {
                    reason: 'conflict',
                },
                {
                    status: 409,
                }
            )
        );

        await expect(transport.request('/anything')).rejects.toEqual(
            new HttpError(409, {
                reason: 'conflict',
            })
        );
    });
});
