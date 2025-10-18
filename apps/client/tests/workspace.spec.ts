import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { platform, release } from 'node:os';

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

async function recordEnvironment(
    page: Page,
    testInfo: TestInfo,
    browserVersion: string
): Promise<void> {
    const environment = await page.evaluate(() => {
        const canvas = document.querySelector<HTMLCanvasElement>('.schema-editor canvas');
        const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
        const debug = gl?.getExtension('WEBGL_debug_renderer_info');
        const fonts: {
            family: string;
            status: string;
            weight: string;
        }[] = [];
        document.fonts.forEach(font =>
            fonts.push({
                family: font.family,
                status: font.status,
                weight: font.weight,
            })
        );

        return {
            userAgent: navigator.userAgent,
            viewport: {
                width: innerWidth,
                height: innerHeight,
            },
            devicePixelRatio,
            fonts,
            bodyFont: getComputedStyle(document.body).fontFamily,
            webgl: gl
                ? {
                      version: gl.getParameter(gl.VERSION),
                      vendor: gl.getParameter(gl.VENDOR),
                      renderer: gl.getParameter(gl.RENDERER),
                      unmaskedVendor: debug
                          ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL)
                          : null,
                      unmaskedRenderer: debug
                          ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
                          : null,
                  }
                : null,
        };
    });
    expect(environment.webgl, 'The editor must have a real WebGL context').not.toBeNull();
    await recordJson(testInfo, 'environment', {
        browserVersion,
        os: {
            platform: platform(),
            release: release(),
        },
        ...environment,
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

test('creates an analysis, edits the federated editor and reopens a saved revision', async ({
    page,
    browser,
}, testInfo) => {
    await page.goto('/');
    await expect(
        page.getByRole('heading', {
            name: 'Your schemas',
        })
    ).toBeVisible();
    await expect(
        page.getByRole('link', {
            name: /Product catalog/,
        })
    ).toContainText('3 source documents · r1');
    await expect(
        page.getByRole('link', {
            name: /Customer orders/,
        })
    ).toContainText('2 source documents · r1');
    await screenshot(page, testInfo, 'workspace-initial');

    await page.getByLabel('Schema title').fill('Imported invoice');
    await page.locator('input[type="file"]').setInputFiles({
        name: 'invoice.xml',
        mimeType: 'application/xml',
        buffer: Buffer.from('<invoice><number>42</number></invoice>'),
    });
    await expect(
        page.getByText('invoice.xml', {
            exact: true,
        })
    ).toBeVisible();
    await expect(
        page.getByRole('button', {
            name: 'Create demo schema',
        })
    ).toBeEnabled();
    await page
        .getByRole('button', {
            name: 'Create demo schema',
        })
        .click();
    await expect(page).toHaveURL(
        /\/edit\?analysisId=analysis-[^&]+&revision=analysis-1$/
    );
    await settled(page);
    await expect
        .poll(() => rowNames(page))
        .toEqual([
            'name',
            'amount',
            'status',
        ]);
    const initial = await diagnostic(page);
    expect(initial.model.cards).toHaveLength(1);
    expect(initial.model.cards[0]).toMatchObject({
        title: 'document',
        rowWindow: {
            state: 'complete',
            totalItems: 3,
            hasMore: false,
        },
    });
    expect(initial.document).toMatchObject({
        revision: 'r1',
        operations: [],
        canUndo: false,
        canRedo: false,
    });
    expect(auditFor(page).responses).toEqual(
        expect.arrayContaining([
            {
                url: 'http://127.0.0.1:4173/editor-runtime.json',
                status: 200,
            },
            {
                url: 'http://127.0.0.1:3010/mf-manifest.json',
                status: 200,
            },
        ])
    );
    expect(
        auditFor(page).responses.some(
            response =>
                response.url.startsWith('http://127.0.0.1:3010/') &&
                /\.js$/.test(response.url) &&
                response.status === 200
        )
    ).toBe(true);
    await recordEnvironment(page, testInfo, browser.version());
    await screenshot(page, testInfo, 'editor-initial');

    await rename(page, 'customerName');
    expect((await diagnostic(page)).document.operations).toEqual([
        {
            kind: 'renameXmlName',
            target: {
                kind: 'node',
                id: 'field-name',
            },
            name: {
                namespaceUri: null,
                localName: 'customerName',
            },
        },
    ]);
    await page
        .getByRole('button', {
            name: 'Undo',
            exact: true,
        })
        .click();
    await expect
        .poll(() => rowNames(page))
        .toEqual([
            'name',
            'amount',
            'status',
        ]);
    await expect(
        page.getByRole('button', {
            name: 'Redo',
            exact: true,
        })
    ).toBeEnabled();
    await page
        .getByRole('button', {
            name: 'Redo',
            exact: true,
        })
        .click();
    await expect
        .poll(() => rowNames(page))
        .toEqual([
            'customerName',
            'amount',
            'status',
        ]);
    await settled(page);
    await screenshot(page, testInfo, 'editor-renamed');

    await page
        .getByRole('button', {
            name: 'Save schema',
            exact: true,
        })
        .click();
    await expect.poll(async () => (await diagnostic(page)).document.revision).toBe('r2');
    await expect
        .poll(async () => (await diagnostic(page)).document.operations)
        .toEqual([]);
    await page
        .getByRole('button', {
            name: 'Exit editor',
            exact: true,
        })
        .click();
    const savedCard = page.getByRole('link', {
        name: /Imported invoice/,
    });
    await expect(savedCard).toContainText('1 source document · r2');
    await expect(savedCard).toHaveAttribute('href', /schemaId=draft-analysis-[^&]+/);
    await screenshot(page, testInfo, 'workspace-saved');
    await page.reload();
    await expect(savedCard).toContainText('1 source document · r2');
    await savedCard.click();
    await settled(page);
    await expect
        .poll(() => rowNames(page))
        .toEqual([
            'customerName',
            'amount',
            'status',
        ]);
    expect((await diagnostic(page)).document).toMatchObject({
        revision: 'r2',
        operations: [],
        canUndo: false,
        canRedo: false,
    });
    await screenshot(page, testInfo, 'editor-reopened');
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
