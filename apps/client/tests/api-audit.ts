import { expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { platform, release } from 'node:os';
import { recordJson, state } from './api-editor';

type ApiRequest = {
    method: string;
    origin: string;
    path: string;
    ifMatch?: string;
    idempotencyKey?: string;
    body: string | null;
};
type ApiResponse = {
    method: string;
    path: string;
    status: number;
    headers: Record<string, string>;
    body: unknown;
};
export type Audit = {
    errors: string[];
    requests: ApiRequest[];
    responses: ApiResponse[];
    pending: Promise<void>[];
};

export function observe(page: Page, audit: Audit): void {
    page.on('pageerror', error => audit.errors.push(error.message));
    page.on('console', message => {
        if (message.type() === 'error') {
            audit.errors.push(message.text());
        }
    });
    page.on('request', request => {
        const url = new URL(request.url());

        if (url.pathname.startsWith('/api/v2/')) {
            audit.requests.push({
                method: request.method(),
                origin: url.origin,
                path: url.pathname,
                ifMatch: request.headers()['if-match'],
                idempotencyKey: request.headers()['idempotency-key'],
                body: request.postData(),
            });
        }
    });
    page.on('response', response => {
        const url = new URL(response.url());

        if (url.pathname.startsWith('/api/v2/')) {
            audit.pending.push(
                response.json().then(
                    body => {
                        audit.responses.push({
                            method: response.request().method(),
                            path: url.pathname,
                            status: response.status(),
                            headers: response.headers(),
                            body,
                        });
                    },
                    error => {
                        audit.errors.push(`Unreadable API response ${url}: ${error}`);
                    }
                )
            );
        }
    });
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

export async function finishAudit(page: Page, testInfo: TestInfo, audit: Audit): Promise<void> {
    await Promise.all(audit.pending);
    await recordJson(testInfo, 'api-audit', {
        errors: audit.errors,
        requests: audit.requests,
        responses: audit.responses,
        state: await state(page).catch(() => null),
    });
    expect(audit.errors).toEqual([]);
    expect(audit.responses.filter(response => response.status >= 400)).toEqual([]);
    expect(audit.requests.every(request => request.origin === 'http://127.0.0.1:8010'))
        .toBe(true);
}
