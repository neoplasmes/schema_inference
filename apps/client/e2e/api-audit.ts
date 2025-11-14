import { expect } from '@playwright/test';
import type { Page, Request, TestInfo } from '@playwright/test';
import { platform, release } from 'node:os';
import { recordJson, state } from './api-editor';

type ApiRequest = {
    method: string;
    url: string;
    origin: string;
    path: string;
    ifMatch?: string;
    idempotencyKey?: string;
    body: string | null;
    failure?: string;
};
type ApiResponse = {
    method: string;
    url: string;
    path: string;
    status: number;
    headers: Record<string, string>;
    body: unknown;
    failure?: string;
};
export type Audit = {
    errors: string[];
    requests: ApiRequest[];
    responses: ApiResponse[];
    pending: Promise<void>[];
};
const activeRequests = new WeakMap<Audit, Set<Request>>();

export function observe(page: Page, audit: Audit): void {
    const active = activeRequests.get(audit) ?? new Set<Request>();
    const requests = new WeakMap<Request, ApiRequest>();
    activeRequests.set(audit, active);
    page.on('pageerror', error => audit.errors.push(error.message));
    page.on('console', message => {
        if (message.type() === 'error') {
            audit.errors.push(message.text());
        }
    });
    page.on('request', request => {
        const url = new URL(request.url());

        if (process.env.WORKSPACE_CONTAINER === '1' && url.port === '3010') {
            audit.errors.push(`Container requested a development remote: ${url}`);
        }

        if (url.pathname.startsWith('/api/v2/')) {
            active.add(request);
            const entry: ApiRequest = {
                method: request.method(),
                url: request.url(),
                origin: url.origin,
                path: url.pathname,
                ifMatch: request.headers()['if-match'],
                idempotencyKey: request.headers()['idempotency-key'],
                body: request.postData(),
            };
            requests.set(request, entry);
            audit.requests.push(entry);
        }
    });
    page.on('requestfailed', request => {
        active.delete(request);
        const entry = requests.get(request);

        if (!entry) {
            return;
        }

        entry.failure = request.failure()?.errorText ?? 'Unknown network failure';

        if (entry.method !== 'GET' || entry.failure !== 'net::ERR_ABORTED') {
            audit.errors.push(`Failed API request ${entry.url}: ${entry.failure}`);
        }
    });
    page.on('response', response => {
        const url = new URL(response.url());

        if (url.pathname.startsWith('/api/v2/')) {
            const entry: ApiResponse = {
                method: response.request().method(),
                url: response.url(),
                path: url.pathname,
                status: response.status(),
                headers: response.headers(),
                body: null,
            };
            audit.responses.push(entry);
            audit.pending.push(
                response
                    .json()
                    .then(
                        body => {
                            entry.body = body;
                        },
                        error => {
                            const failure = response.request().failure()?.errorText;

                            if (
                                entry.method === 'GET' &&
                                entry.status < 400 &&
                                failure === 'net::ERR_ABORTED'
                            ) {
                                entry.failure = failure;

                                return;
                            }

                            audit.errors.push(`Unreadable API response ${url}: ${error}`);
                        }
                    )
                    .finally(() => active.delete(response.request()))
            );
        }
    });
}

export async function settleAudit(audit: Audit): Promise<void> {
    await expect.poll(() => activeRequests.get(audit)?.size ?? 0).toBe(0);
    await Promise.all(audit.pending);
}

export async function environment(page: Page, browserVersion: string): Promise<unknown> {
    const details = await page.evaluate(() => {
        const canvas = document.querySelector<HTMLCanvasElement>('.schema-editor canvas');
        const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
        const debug = gl?.getExtension('WEBGL_debug_renderer_info');

        return {
            viewport: {
                width: innerWidth,
                height: innerHeight,
            },
            devicePixelRatio,
            userAgent: navigator.userAgent,
            fonts: Array.from(document.fonts).map(font => ({
                family: font.family,
                status: font.status,
            })),
            bodyFont: getComputedStyle(document.body).fontFamily,
            webgl: gl
                ? {
                      version: gl.getParameter(gl.VERSION),
                      renderer: debug
                          ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
                          : gl.getParameter(gl.RENDERER),
                  }
                : null,
        };
    });
    expect(details.webgl).not.toBeNull();

    return {
        browserVersion,
        os: {
            platform: platform(),
            release: release(),
        },
        ...details,
    };
}

export async function finishAudit(
    page: Page,
    testInfo: TestInfo,
    audit: Audit
): Promise<void> {
    await settleAudit(audit);
    await recordJson(testInfo, 'api-audit', {
        errors: audit.errors,
        requests: audit.requests,
        responses: audit.responses,
        state: await state(page).catch(() => null),
    });
    expect(audit.errors).toEqual([]);
    expect(audit.responses.filter(response => response.status >= 400)).toEqual([]);
    expect(
        [
            ...audit.requests,
            ...audit.responses,
        ].filter(
            response =>
                response.failure &&
                !audit.responses.some(
                    completed =>
                        completed.method === 'GET' &&
                        completed.url === response.url &&
                        completed.status < 400 &&
                        !completed.failure &&
                        completed.body !== null
                )
        ),
        'Every cancelled read must have a completed response for the same resource'
    ).toEqual([]);
    const origin =
        process.env.WORKSPACE_CONTAINER === '1'
            ? 'http://127.0.0.1:4173'
            : 'http://127.0.0.1:8010';
    expect(audit.requests.every(request => request.origin === origin)).toBe(true);
}
