import { describe, expect, it, vi } from 'vitest';
import { TransportSessionRepo } from '.';
import { HttpError, MockHttpTransport } from '../../transport';

describe('transport session repo', () => {
    it('maps the current session and ends it through the API', async () => {
        const handler = vi.fn(async (_path: string, options?: RequestInit) =>
            options?.method === 'DELETE'
                ? Response.json({
                      endSessionUrl: 'https://idp.test/logout',
                  })
                : Response.json({
                      sub: 'user-1',
                      roles: [
                          'user',
                      ],
                  })
        );
        const repo = new TransportSessionRepo(new MockHttpTransport(handler));

        expect(await repo.getCurrent()).toEqual({
            ref: 'session:current',
            sub: 'user-1',
            roles: [
                'user',
            ],
        });
        expect(await repo.end()).toEqual({
            endSessionUrl: 'https://idp.test/logout',
        });
        expect(handler).toHaveBeenLastCalledWith(
            '/api/v2/session',
            expect.objectContaining({
                method: 'DELETE',
            })
        );
    });

    it('reports 401 responses to the registered handler only', async () => {
        const status = {
            value: 401,
        };
        const repo = new TransportSessionRepo(
            new MockHttpTransport(async () =>
                Response.json(
                    {
                        code: 'unauthenticated',
                    },
                    {
                        status: status.value,
                    }
                )
            )
        );
        const onUnauthenticated = vi.fn();
        repo.attachInterceptors(onUnauthenticated);

        await expect(repo.getCurrent()).rejects.toBeInstanceOf(HttpError);
        expect(onUnauthenticated).toHaveBeenCalledTimes(1);

        status.value = 403;
        await expect(repo.getCurrent()).rejects.toBeInstanceOf(HttpError);
        expect(onUnauthenticated).toHaveBeenCalledTimes(1);
    });
});
