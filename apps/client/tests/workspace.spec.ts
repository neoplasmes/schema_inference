import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

type Rectangle = {
    x: number;
    y: number;
    width: number;
    height: number;
};
type Diagnostic = {
    ready: boolean;
    model: {
        version: number;
        state: string;
        cards: {
            blockId: string;
            title: string;
            rows: {
                memberId: string;
                name: string;
            }[];
            rowWindow: {
                state: string;
                totalItems: number;
                hasMore: boolean;
            };
        }[];
    };
    viewport: {
        x: number;
        y: number;
        zoom: number;
    };
    geometry: {
        version: number;
        cards: {
            blockId: string;
            rows: {
                memberId: string;
                bounds: Rectangle;
                nameBounds?: Rectangle;
            }[];
        }[];
    };
    stats: {
        renderedFrames: number;
        visibleCards: number;
    };
    document: {
        operations: unknown[];
        revision: string;
        canUndo: boolean;
        canRedo: boolean;
    };
};
type DiagnosticWindow = Window & {
    __editorPlayground?: {
        read(): Diagnostic;
    };
};
type Audit = {
    requests: {
        method: string;
        url: string;
        type: string;
    }[];
    responses: {
        url: string;
        status: number;
    }[];
    pageErrors: string[];
    consoleErrors: string[];
    webSockets: string[];
    expectedErrors: RegExp[];
};

const audits = new WeakMap<Page, Audit>();

function auditFor(page: Page): Audit {
    const audit = audits.get(page);

    if (!audit) {
        throw new Error('Browser audit was not initialized.');
    }

    return audit;
}

async function diagnostic(page: Page): Promise<Diagnostic> {
    return page.evaluate(() => {
        const handle = (window as DiagnosticWindow).__editorPlayground;

        if (!handle) {
            throw new Error('Editor diagnostics are unavailable.');
        }

        return handle.read();
    });
}

async function settled(page: Page): Promise<void> {
    await page.waitForFunction(() => {
        const state = (window as DiagnosticWindow).__editorPlayground?.read();

        return (
            state?.ready &&
            state.model.state === 'ready' &&
            state.stats.renderedFrames > 0 &&
            state.geometry?.cards.length > 0 &&
            state.geometry.version === state.model.version
        );
    });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.evaluate(
        () =>
            new Promise<void>(resolve => {
                requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
            })
    );
    await expect(page.locator('.schema-editor canvas')).toHaveCount(1);
}

async function rowNames(page: Page): Promise<string[]> {
    return (await diagnostic(page)).model.cards.flatMap(card =>
        card.rows.map(row => row.name)
    );
}

async function openRename(page: Page): Promise<void> {
    const state = await diagnostic(page);
    const card = state.geometry.cards.find(item =>
        item.rows.some(row => row.memberId === 'member-name')
    );
    const row = card?.rows.find(item => item.memberId === 'member-name');
    const canvas = await page.locator('.schema-editor canvas').boundingBox();

    expect(row).toBeDefined();
    expect(canvas).not.toBeNull();

    const bounds = row!.nameBounds ?? row!.bounds;
    const x =
        canvas!.x +
        state.viewport.x +
        (bounds.x + bounds.width / 2) * state.viewport.zoom;
    const y =
        canvas!.y +
        state.viewport.y +
        (bounds.y + bounds.height / 2) * state.viewport.zoom;
    await page.mouse.dblclick(x, y);
    await expect(
        page.getByRole('textbox', {
            name: 'Field name',
            exact: true,
        })
    ).toBeFocused();
}

async function rename(page: Page, name: string): Promise<void> {
    await openRename(page);
    await page.keyboard.press('Control+A');
    await page.keyboard.type(name);
    await page.keyboard.press('Enter');
    await expect(
        page.getByRole('textbox', {
            name: 'Field name',
            exact: true,
        })
    ).toHaveCount(0);
    await expect
        .poll(() => rowNames(page))
        .toEqual([
            name,
            'amount',
            'status',
        ]);
    await settled(page);
}

async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const path = testInfo.outputPath(`${name}.png`);
    await page.screenshot({
        path,
        fullPage: true,
    });
    await testInfo.attach(name, {
        path,
        contentType: 'image/png',
    });
}

async function recordJson(
    testInfo: TestInfo,
    name: string,
    value: unknown
): Promise<void> {
    const path = testInfo.outputPath(`${name}.json`);
    await writeFile(
        path,
        JSON.stringify(
            value,
            (_key, item: unknown) => (item instanceof RegExp ? item.source : item),
            2
        )
    );
    await testInfo.attach(name, {
        path,
        contentType: 'application/json',
    });
}

test.beforeEach(async ({ page }) => {
    const audit: Audit = {
        requests: [],
        responses: [],
        pageErrors: [],
        consoleErrors: [],
        webSockets: [],
        expectedErrors: [],
    };
    audits.set(page, audit);
    page.on('request', request =>
        audit.requests.push({
            method: request.method(),
            url: request.url(),
            type: request.resourceType(),
        })
    );
    page.on('response', response =>
        audit.responses.push({
            url: response.url(),
            status: response.status(),
        })
    );
    page.on('pageerror', error => audit.pageErrors.push(error.message));
    page.on('console', message => {
        if (message.type() === 'error') {
            audit.consoleErrors.push(message.text());
        }
    });
    page.on('websocket', socket => audit.webSockets.push(socket.url()));
});

test.afterEach(async ({ page }, testInfo) => {
    const audit = auditFor(page);
    await recordJson(testInfo, 'browser-audit', audit);
    expect(
        audit.requests.filter(request =>
            /^\/api(?:\/|$)/.test(new URL(request.url).pathname)
        ),
        'Business requests must stay inside the injected mock transport'
    ).toEqual([]);
    expect(audit.webSockets).toEqual([]);
    expect(
        audit.pageErrors.filter(
            error => !audit.expectedErrors.some(expected => expected.test(error))
        )
    ).toEqual([]);
    expect(
        audit.consoleErrors.filter(
            error => !audit.expectedErrors.some(expected => expected.test(error))
        )
    ).toEqual([]);
});

test('recovers after runtime configuration fails once', async ({ page }, testInfo) => {
    const audit = auditFor(page);
    audit.expectedErrors.push(
        /The editor runtime configuration is unavailable\./,
        /Failed to load resource: the server responded with a status of 503/
    );
    let configurationRequests = 0;
    await page.route('**/editor-runtime.json', async route => {
        configurationRequests += 1;

        if (configurationRequests === 1) {
            await route.fulfill({
                status: 503,
                contentType: 'application/json',
                body: '{}',
            });

            return;
        }

        await route.continue();
    });
    await page.goto('/');
    await page
        .getByRole('link', {
            name: /Product catalog/,
        })
        .click();
    await expect(
        page.getByRole('heading', {
            name: 'Editor could not load',
        })
    ).toBeVisible();
    await expect(page.locator('.schema-editor canvas')).toHaveCount(0);
    await screenshot(page, testInfo, 'remote-unavailable');
    await page
        .getByRole('button', {
            name: 'Try again',
            exact: true,
        })
        .click();
    await settled(page);
    expect(configurationRequests).toBe(2);
    await expect
        .poll(() => rowNames(page))
        .toEqual([
            'name',
            'amount',
            'status',
        ]);
    await expect(
        page.getByRole('heading', {
            name: 'Editor could not load',
        })
    ).toHaveCount(0);
    await screenshot(page, testInfo, 'remote-recovered');
});

test('keeps unsaved edits and controls isolated across repeated openings', async ({
    page,
}, testInfo) => {
    await page.goto('/');

    for (const title of [
        'Product catalog',
        'Customer orders',
        'Product catalog',
    ]) {
        await page
            .getByRole('link', {
                name: new RegExp(title),
            })
            .click();
        await settled(page);
        await expect
            .poll(() => rowNames(page))
            .toEqual([
                'name',
                'amount',
                'status',
            ]);
        expect((await diagnostic(page)).document).toMatchObject({
            revision: 'r1',
            operations: [],
            canUndo: false,
            canRedo: false,
        });

        const zoom = (await diagnostic(page)).viewport.zoom;
        await page
            .getByRole('button', {
                name: 'Zoom in',
                exact: true,
            })
            .click();
        await expect
            .poll(async () => (await diagnostic(page)).viewport.zoom)
            .toBeGreaterThan(zoom);
        expect((await diagnostic(page)).document.operations).toEqual([]);
        await settled(page);
        await openRename(page);
        await page.keyboard.press('Control+A');
        await page.keyboard.type('cancelledName');
        await page.keyboard.press('Escape');
        await expect(
            page.getByRole('textbox', {
                name: 'Field name',
                exact: true,
            })
        ).toHaveCount(0);
        expect(await rowNames(page)).toEqual([
            'name',
            'amount',
            'status',
        ]);
        expect((await diagnostic(page)).document.operations).toEqual([]);
        await rename(page, 'unsavedName');
        await page
            .getByRole('button', {
                name: 'Exit editor',
                exact: true,
            })
            .click();
        await expect(
            page.getByRole('heading', {
                name: 'Your schemas',
            })
        ).toBeVisible();
        await expect(page.locator('canvas')).toHaveCount(0);
        await expect(
            page.getByRole('textbox', {
                name: 'Field name',
                exact: true,
            })
        ).toHaveCount(0);
        await expect
            .poll(() =>
                page.evaluate(
                    () => (window as DiagnosticWindow).__editorPlayground === undefined
                )
            )
            .toBe(true);
        await page.keyboard.press('Control+z');
    }

    await screenshot(page, testInfo, 'workspace-after-disposal');
});
