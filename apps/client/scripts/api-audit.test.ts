import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { Page, TestInfo } from '@playwright/test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { finishAudit, observe, settleAudit, type Audit } from '../e2e/api-audit';

const directories: string[] = [];
const resource =
    'http://127.0.0.1:8010/api/v2/schemas/schema-1/revisions/s1/nodes/node-6';

afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(
        directories.splice(0).map(directory =>
            rm(directory, {
                recursive: true,
                force: true,
            })
        )
    );
});

async function fixture() {
    const directory = await mkdtemp(path.join(tmpdir(), 'api-audit-'));
    directories.push(directory);
    const events = new EventEmitter();
    const page = events as unknown as Page;
    const audit: Audit = {
        errors: [],
        requests: [],
        responses: [],
        pending: [],
    };
    observe(page, audit);
    const testInfo = {
        outputPath: (name: string) => path.join(directory, name),
        attach: async () => {},
    } as unknown as TestInfo;

    return {
        audit,
        events,
        finish: () => finishAudit(page, testInfo, audit),
        respond: async (
            method: string,
            status: number,
            failure?: string,
            body?: unknown,
            url = resource
        ) => {
            events.emit('response', {
                url: () => url,
                request: () => ({
                    method: () => method,
                    failure: () =>
                        failure
                            ? {
                                  errorText: failure,
                              }
                            : null,
                }),
                status: () => status,
                headers: () => ({
                    'content-type': 'application/json',
                }),
                json: async () => {
                    if (body === undefined) {
                        throw new Error(
                            'No data found for resource with given identifier'
                        );
                    }

                    return body;
                },
            });
            await Promise.all(audit.pending);
        },
    };
}

describe('browser API audit', () => {
    it('rejects a development remote in container mode', async () => {
        vi.stubEnv('WORKSPACE_CONTAINER', '1');
        const result = await fixture();
        result.events.emit('request', {
            url: () => 'http://localhost:3010/remoteEntry.js',
        });
        expect(result.audit.errors).toHaveLength(1);
        await expect(result.finish()).rejects.toThrow();
    });

    it('drains requests started before headers until their bodies are captured', async () => {
        const result = await fixture();
        const request = {
            url: () => resource,
            method: () => 'GET',
            headers: () => ({}),
            postData: () => null,
        };
        result.events.emit('request', request);
        const settled = settleAudit(result.audit).then(() => 'settled');
        expect(
            await Promise.race([
                settled,
                delay(25, 'pending'),
            ])
        ).toBe('pending');
        let resolveBody!: (body: unknown) => void;
        const body = new Promise(resolve => {
            resolveBody = resolve;
        });
        result.events.emit('response', {
            url: () => resource,
            request: () => request,
            status: () => 200,
            headers: () => ({
                'content-type': 'application/json',
            }),
            json: () => body,
        });
        expect(
            await Promise.race([
                settled,
                delay(25, 'pending'),
            ])
        ).toBe('pending');
        resolveBody({
            id: 'node-6',
        });
        expect(await settled).toBe('settled');
        expect(result.audit.responses[0].body).toEqual({
            id: 'node-6',
        });
    });

    it('drains a cancelled read before headers and requires its completed replacement', async () => {
        const result = await fixture();
        const request = {
            url: () => resource,
            method: () => 'GET',
            headers: () => ({}),
            postData: () => null,
            failure: () => ({
                errorText: 'net::ERR_ABORTED',
            }),
        };
        result.events.emit('request', request);
        result.events.emit('requestfailed', request);
        await expect(settleAudit(result.audit)).resolves.toBeUndefined();
        expect(result.audit.requests[0].failure).toBe('net::ERR_ABORTED');
        await expect(result.finish()).rejects.toThrow();
        await result.respond(
            'GET',
            200,
            undefined,
            {
                id: 'node-6',
            },
            `${resource}?scopeId=other`
        );
        await expect(result.finish()).rejects.toThrow();
        await result.respond('GET', 200, undefined, {
            id: 'node-6',
        });
        await expect(result.finish()).resolves.toBeUndefined();
    });

    it.each([
        {
            method: 'GET',
            failure: 'net::ERR_CONNECTION_RESET',
        },
        {
            method: 'POST',
            failure: 'net::ERR_ABORTED',
        },
        {
            method: 'PATCH',
            failure: 'net::ERR_ABORTED',
        },
    ])(
        'rejects a $method $failure failure before response headers arrive',
        async input => {
            const result = await fixture();
            const request = {
                url: () => resource,
                method: () => input.method,
                headers: () => ({}),
                postData: () => null,
                failure: () => ({
                    errorText: input.failure,
                }),
            };
            result.events.emit('request', request);
            result.events.emit('requestfailed', request);
            await expect(settleAudit(result.audit)).resolves.toBeUndefined();
            expect(result.audit.errors).toEqual([
                `Failed API request ${resource}: ${input.failure}`,
            ]);
            await expect(result.finish()).rejects.toThrow();
        }
    );

    it('retains a cancelled read and requires its completed replacement', async () => {
        const result = await fixture();
        await result.respond('GET', 200, 'net::ERR_ABORTED');
        expect(result.audit.errors).toEqual([]);
        expect(result.audit.responses).toEqual([
            {
                method: 'GET',
                url: resource,
                path: '/api/v2/schemas/schema-1/revisions/s1/nodes/node-6',
                status: 200,
                headers: {
                    'content-type': 'application/json',
                },
                body: null,
                failure: 'net::ERR_ABORTED',
            },
        ]);
        await expect(result.finish()).rejects.toThrow();
        await result.respond(
            'GET',
            200,
            undefined,
            {
                id: 'node-6',
            },
            `${resource}?scopeId=other`
        );
        await expect(result.finish()).rejects.toThrow();
        await result.respond('GET', 200, undefined, {
            id: 'node-6',
        });
        await expect(result.finish()).resolves.toBeUndefined();
    });

    it.each([
        {
            method: 'POST',
            status: 201,
            failure: 'net::ERR_ABORTED',
        },
        {
            method: 'GET',
            status: 503,
            failure: 'net::ERR_ABORTED',
        },
        {
            method: 'GET',
            status: 200,
            failure: 'net::ERR_CONNECTION_RESET',
        },
        {
            method: 'GET',
            status: 200,
            failure: undefined,
        },
    ])('rejects an unreadable $method $status response with $failure', async input => {
        const result = await fixture();
        await result.respond(input.method, input.status, input.failure);
        expect(result.audit.errors).toHaveLength(1);
        expect(result.audit.responses).toHaveLength(1);
        await expect(result.finish()).rejects.toThrow();
    });

    it('rejects an HTTP error even when its JSON body is readable', async () => {
        const result = await fixture();
        await result.respond('GET', 500, undefined, {
            error: 'storage unavailable',
        });
        expect(result.audit.errors).toEqual([]);
        await expect(result.finish()).rejects.toThrow();
    });
});
