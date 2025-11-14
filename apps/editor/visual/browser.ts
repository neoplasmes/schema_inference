import { chromium, expect, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BoardGeometry, BoardModel, BoardViewport } from '../src/board';
import { references } from '../playground/references';

type State = {
    ready: boolean;
    scene: string;
    model: BoardModel;
    viewport: BoardViewport;
    geometry: BoardGeometry;
    stats: {
        renderedFrames: number;
        edgeGraphics?: number;
        edgeLayerRedraws?: number;
        visibleCards?: number;
        visibleConnections?: number;
    };
    document: {
        operations: unknown[];
        canUndo: boolean;
        canRedo: boolean;
        revision: string;
    };
};

const output = resolve(dirname(fileURLToPath(import.meta.url)), 'actual/browser');
const base = process.env.EDITOR_URL ?? 'http://127.0.0.1:3010';
await mkdir(output, {
    recursive: true,
});
const browser = await chromium.launch({
    headless: true,
    args: [
        '--use-gl=swiftshader',
        '--enable-unsafe-swiftshader',
    ],
});
const context = await browser.newContext({
    viewport: {
        width: 1440,
        height: 900,
    },
    deviceScaleFactor: 2,
});
await context.addInitScript('globalThis.__name = (value) => value;');
const results: unknown[] = [];
const requested = process.argv.slice(2);

function state(page: Page): Promise<State> {
    return page.evaluate(() =>
        (
            window as unknown as {
                __editorPlayground: {
                    read(): State;
                };
            }
        ).__editorPlayground.read()
    );
}

async function settled(page: Page): Promise<void> {
    await page.waitForFunction(() => {
        const value = (
            window as unknown as {
                __editorPlayground?: {
                    read(): State;
                };
            }
        ).__editorPlayground?.read();

        return value?.ready && value.stats.renderedFrames > 0;
    });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(
        () =>
            new Promise<void>(done =>
                requestAnimationFrame(() => requestAnimationFrame(() => done()))
            )
    );
}

async function open(page: Page, scene = 'main'): Promise<void> {
    await page.goto(`${base}/?scene=${scene}`);
    await settled(page);
}

function rowName(snapshot: State, block: string, member: string): string | undefined {
    return snapshot.model.cards
        .find(card => card.blockId === block)
        ?.rows.find(row => row.memberId === member)?.name;
}

async function scenario(
    name: string,
    action: (page: Page) => Promise<unknown>,
    expectedError?: RegExp
): Promise<void> {
    if (requested.length > 0 && !requested.includes(name)) {
        return;
    }

    const page = await context.newPage();
    const errors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => {
        if (message.type() === 'error') {
            consoleErrors.push(message.text());
        }
    });
    await context.tracing.start({
        screenshots: true,
        snapshots: true,
        sources: true,
    });
    let evidence: unknown;

    try {
        evidence = await action(page);
        expect(errors.filter(error => !expectedError?.test(error))).toEqual([]);
        await page.screenshot({
            path: resolve(output, `${name}.png`),
        });
        results.push({
            name,
            passed: true,
            evidence,
            errors,
            consoleErrors,
        });
        console.log(`PASS ${name}`);
    } catch (error) {
        await page.screenshot({
            path: resolve(output, `${name}-failure.png`),
        });
        results.push({
            name,
            passed: false,
            evidence,
            error: String(error),
            errors,
            consoleErrors,
            state: await state(page).catch(() => null),
        });
        process.exitCode = 1;
        console.error(`FAIL ${name}: ${String(error)}`);
    } finally {
        await context.tracing.stop({
            path: resolve(output, `${name}-trace.zip`),
        });
        await page.close();
    }
}

await scenario('selection-rename-history', async page => {
    await open(page);
    const before = await state(page);
    const order = before.geometry.cards.find(card => card.blockId === 'order')!;
    expect(order.bounds).toEqual({
        x: 300,
        y: 110,
        width: 248,
        height: 182,
    });
    expect(order.rows[0].bounds).toEqual({
        x: 304,
        y: 148,
        width: 240,
        height: 28,
    });
    await page.mouse.click(360, 162);
    await expect
        .poll(async () => (await state(page)).model.selection)
        .toEqual({
            blockId: 'order',
            memberId: 'id',
        });
    await expect(
        page.getByRole('treeitem', {
            selected: true,
        })
    ).toHaveCount(1);
    await page.keyboard.press('F2');
    const input = page.getByRole('textbox', {
        name: 'Field name',
    });
    await expect(input).toBeFocused();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('orderId');
    await page.keyboard.press('Enter');
    await expect
        .poll(async () => rowName(await state(page), 'order', 'id'))
        .toBe('orderId');
    expect((await state(page)).document.operations).toHaveLength(1);
    await page
        .getByRole('button', {
            name: 'Undo',
            exact: true,
        })
        .click();
    await expect.poll(async () => rowName(await state(page), 'order', 'id')).toBe('id');
    await page
        .getByRole('button', {
            name: 'Redo',
            exact: true,
        })
        .click();
    await expect
        .poll(async () => rowName(await state(page), 'order', 'id'))
        .toBe('orderId');
    await page.mouse.click(360, 162);
    await page.keyboard.press('F2');
    await expect(input).toBeFocused();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('discardThis');
    await page.keyboard.press('Escape');
    expect(rowName(await state(page), 'order', 'id')).toBe('orderId');
    expect((await state(page)).document.operations).toHaveLength(3);

    return {
        initialGeometry: order,
        finalDocument: (await state(page)).document,
    };
});

await scenario('camera-pan-cursor-zoom', async page => {
    await open(page);
    await page.mouse.move(970, 720);
    await page.mouse.down();
    await page.mouse.move(1010, 750, {
        steps: 8,
    });
    await page.mouse.up();
    await expect
        .poll(async () => (await state(page)).viewport)
        .toEqual({
            x: 40,
            y: 30,
            zoom: 1,
        });
    const before = (await state(page)).viewport;
    await page.mouse.move(940, 700);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -20);
    await page.keyboard.up('Control');
    await expect.poll(async () => (await state(page)).viewport.zoom).toBeGreaterThan(1);
    const after = (await state(page)).viewport;
    expect((940 - after.x) / after.zoom).toBeCloseTo((940 - before.x) / before.zoom, 5);
    expect((700 - after.y) / after.zoom).toBeCloseTo((700 - before.y) / before.zoom, 5);
    expect((await state(page)).document.operations).toHaveLength(0);

    return {
        before,
        after,
    };
});

await scenario('keyboard-unicode-input-composition-guard', async page => {
    await open(page);
    await page.mouse.click(360, 162);
    await page.keyboard.press('ArrowDown');
    await expect
        .poll(async () => (await state(page)).model.selection?.memberId)
        .toBe('customer');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('F2');
    const input = page.getByRole('textbox', {
        name: 'Field name',
    });
    await expect(input).toBeFocused();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('поле');
    await input.dispatchEvent('compositionstart', {
        data: 'поле',
    });
    await page.keyboard.press('Enter');
    await expect(input).toBeVisible();
    expect((await state(page)).document.operations).toHaveLength(0);
    await input.dispatchEvent('compositionend', {
        data: 'поле',
    });
    await page.keyboard.press('Enter');
    await expect.poll(async () => rowName(await state(page), 'order', 'id')).toBe('поле');
    expect((await state(page)).document.operations).toHaveLength(1);

    return {
        nativeUnicodeInput: true,
        limitation:
            'Synthetic composition events verify only the Enter guard; no physical IME coverage.',
    };
});

await scenario('synthetic-touch-pinch-and-cancel', async page => {
    await open(page);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', {
        enabled: true,
    });
    await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [
            {
                x: 970,
                y: 720,
                id: 1,
            },
        ],
    });
    await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
            {
                x: 1010,
                y: 750,
                id: 1,
            },
        ],
    });
    await expect.poll(async () => (await state(page)).viewport.x).toBe(40);
    await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchCancel',
        touchPoints: [],
    });
    expect((await state(page)).viewport).toEqual({
        x: 0,
        y: 0,
        zoom: 1,
    });
    await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [
            {
                x: 940,
                y: 720,
                id: 1,
            },
            {
                x: 1040,
                y: 720,
                id: 2,
            },
        ],
    });
    await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
            {
                x: 920,
                y: 700,
                id: 1,
            },
            {
                x: 1060,
                y: 740,
                id: 2,
            },
        ],
    });
    await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
    });
    await expect.poll(async () => (await state(page)).viewport.zoom).toBeGreaterThan(1.4);
    expect((await state(page)).document.operations).toHaveLength(0);

    return {
        viewport: (await state(page)).viewport,
        limitation:
            'CDP touch synthesis exercises browser pointer events; physical touch hardware is untested.',
    };
});

await scenario('bounded-row-window-and-boundary-reveal', async page => {
    await open(page, 'card-anatomy');
    const before = await state(page);
    const initial = before.geometry.cards.find(card => card.blockId === 'product')!;
    expect(initial.rows.map(row => row.memberId)).toEqual([
        'sku',
        'title',
        'price',
        'weight',
        'tags',
    ]);
    expect(initial.bounds.height).toBe(300);
    await page.mouse.move(200, 250);
    await page.mouse.wheel(0, 480);
    await expect
        .poll(async () =>
            (await state(page)).geometry.cards
                .find(card => card.blockId === 'product')!
                .rows.map(row => row.memberId)
        )
        .toEqual([
            'price',
            'weight',
            'tags',
            'attrs-outside-window',
            'media-outside-window',
        ]);
    const scrolled = await state(page);
    expect(scrolled.viewport).toEqual(before.viewport);
    expect(scrolled.document.operations).toHaveLength(0);
    expect(
        scrolled.geometry.cards.find(card => card.blockId === 'product')!.bounds.height
    ).toBeLessThanOrEqual(300);
    await open(page, 'card-anatomy');
    const initialAgain = await state(page);
    const region = initialAgain.geometry.cards
        .find(card => card.blockId === 'product')!
        .regions.find(
            region =>
                region.target.kind === 'boundary' &&
                region.target.memberId === 'attrs-outside-window'
        )!;
    await page.mouse.click(
        region.bounds.x + region.bounds.width / 2,
        region.bounds.y + region.bounds.height / 2
    );
    await expect
        .poll(async () =>
            (await state(page)).geometry.cards
                .find(card => card.blockId === 'product')!
                .rows.some(row => row.memberId === 'attrs-outside-window')
        )
        .toBe(true);
    const revealed = await state(page);
    const row = revealed.geometry.cards
        .find(card => card.blockId === 'product')!
        .rows.find(row => row.memberId === 'attrs-outside-window')!;
    const connection = revealed.geometry.connections.find(
        connection => connection.id === 'product/attrs-outside-window/hidden-attributes'
    )!;
    expect(connection.sourceHidden).toBe(false);
    expect(connection.source.y).toBe(row.bounds.y + row.bounds.height / 2);
    expect(revealed.viewport).toEqual(initialAgain.viewport);
    expect(revealed.document.operations).toHaveLength(0);

    return {
        initial: initial.rowViewport,
        scrolled: scrolled.geometry.cards.find(card => card.blockId === 'product')!
            .rowViewport,
        revealed: revealed.geometry.cards.find(card => card.blockId === 'product')!
            .rowViewport,
        source: connection.source,
    };
});

await scenario('keyboard-reveals-rows-after-ten', async page => {
    await open(page, 'paged');
    await page.mouse.click(360, 132);

    for (let index = 0; index < 12; index += 1) {
        await page.keyboard.press('ArrowDown');
    }

    await expect
        .poll(async () => (await state(page)).model.selection?.memberId)
        .toBe('workload-0-member-12');
    const next = await state(page);
    expect(
        next.geometry.cards
            .find(card => card.blockId === 'workload-0')!
            .rows.some(row => row.memberId === 'workload-0-member-12')
    ).toBe(true);
    expect(
        next.geometry.cards.find(card => card.blockId === 'workload-0')!.rows.length
    ).toBeLessThanOrEqual(10);
    expect(next.document.operations).toHaveLength(0);

    return next.geometry.cards.find(card => card.blockId === 'workload-0')!.rowViewport;
});

await scenario('retained-edge-layers-during-small-pan', async page => {
    await open(page);
    await page.mouse.move(970, 720);
    await page.evaluate(
        () =>
            new Promise<void>(done =>
                requestAnimationFrame(() => requestAnimationFrame(() => done()))
            )
    );
    const before = await state(page);
    expect(before.stats.edgeGraphics).toBe(3);
    await page.mouse.down();
    await page.mouse.move(978, 726, {
        steps: 4,
    });
    await page.mouse.up();
    await page.evaluate(
        () =>
            new Promise<void>(done =>
                requestAnimationFrame(() => requestAnimationFrame(() => done()))
            )
    );
    const after = await state(page);
    expect(after.stats.visibleCards).toBe(before.stats.visibleCards);
    expect(after.stats.visibleConnections).toBe(before.stats.visibleConnections);
    expect(after.stats.edgeLayerRedraws).toBe(before.stats.edgeLayerRedraws);
    expect(after.document.operations).toHaveLength(0);

    return {
        before: before.stats,
        after: after.stats,
    };
});

await scenario('card-drag-cancel-edges', async page => {
    await open(page);
    await page.mouse.move(400, 130);
    await page.mouse.down();
    await page.mouse.move(440, 180, {
        steps: 10,
    });
    await page.mouse.up();
    await expect
        .poll(
            async () =>
                (await state(page)).geometry.cards.find(card => card.blockId === 'order')
                    ?.bounds.x
        )
        .toBe(340);
    const moved = await state(page);
    expect(moved.geometry.cards.find(card => card.blockId === 'order')?.bounds.y).toBe(
        160
    );
    expect(
        moved.geometry.connections.find(edge => edge.id === 'order/customer/customer')
            ?.source
    ).toEqual({
        x: 588,
        y: 240,
    });
    expect(moved.document.operations).toHaveLength(0);
    await page.mouse.move(440, 180);
    await page.mouse.down();
    await page.mouse.move(480, 230, {
        steps: 8,
    });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(
        (await state(page)).geometry.cards.find(card => card.blockId === 'order')?.bounds
    ).toEqual({
        x: 340,
        y: 160,
        width: 248,
        height: 182,
    });
    expect((await state(page)).document.operations).toHaveLength(0);

    return {
        movedGeometry: moved.geometry,
    };
});

await scenario('member-transfer-undo', async page => {
    await open(page);
    await page.mouse.move(365, 274);
    await page.mouse.down();
    await page.mouse.move(700, 132, {
        steps: 12,
    });
    await page.mouse.up();
    await expect
        .poll(async () => rowName(await state(page), 'customer', 'delivery'))
        .toBe('delivery');
    expect(rowName(await state(page), 'order', 'delivery')).toBeUndefined();
    expect((await state(page)).document.operations).toHaveLength(1);
    await page
        .getByRole('button', {
            name: 'Undo',
            exact: true,
        })
        .click();
    await expect
        .poll(async () => rowName(await state(page), 'order', 'delivery'))
        .toBe('delivery');
    expect(rowName(await state(page), 'customer', 'delivery')).toBeUndefined();

    return (await state(page)).document;
});

await scenario('member-reorder-anchored-edge', async page => {
    await open(page);
    await page.mouse.move(365, 274);
    await page.mouse.down();
    await page.mouse.move(365, 178, {
        steps: 12,
    });
    await page.mouse.up();
    await expect
        .poll(async () =>
            (await state(page)).model.cards
                .find(card => card.blockId === 'order')
                ?.rows.map(row => row.memberId)
        )
        .toEqual([
            'id',
            'delivery',
            'customer',
            'payment',
            'items',
        ]);
    const next = await state(page);
    expect(
        next.geometry.connections.find(edge => edge.id === 'order/customer/customer')
            ?.source
    ).toEqual({
        x: 548,
        y: 218,
    });
    expect(next.document.operations).toHaveLength(1);

    return next.geometry.connections;
});

await scenario('collapse-reopen-view-isolation', async page => {
    await open(page);
    await page.mouse.click(534, 190);
    await expect
        .poll(async () =>
            (await state(page)).model.cards.some(card => card.blockId === 'customer')
        )
        .toBe(false);
    await page.mouse.click(534, 190);
    await expect
        .poll(async () =>
            (await state(page)).model.cards.some(card => card.blockId === 'customer')
        )
        .toBe(true);
    expect(
        (await state(page)).geometry.cards.find(card => card.blockId === 'customer')
            ?.bounds
    ).toEqual({
        x: 620,
        y: 90,
        width: 238,
        height: 154,
    });
    expect((await state(page)).document.operations).toHaveLength(0);

    return (await state(page)).document;
});

await scenario('variant-preview-no-semantic-write', async page => {
    await open(page);
    await page.mouse.click(810, 360);
    await expect
        .poll(
            async () =>
                (await state(page)).model.cards.find(card => card.blockId === 'payment')
                    ?.activeVariantId
        )
        .toBe('invoice');
    await expect
        .poll(async () =>
            (await state(page)).model.cards
                .find(card => card.blockId === 'payment')
                ?.rows.some(row => row.name === 'inn')
        )
        .toBe(true);
    expect((await state(page)).document.operations).toHaveLength(0);
    await page.mouse.click(690, 360);
    await expect
        .poll(
            async () =>
                (await state(page)).model.cards.find(card => card.blockId === 'payment')
                    ?.activeVariantId
        )
        .toBe('card');
    expect((await state(page)).document.operations).toHaveLength(0);

    return (await state(page)).model.cards.find(card => card.blockId === 'payment');
});

await scenario('pagination-preserves-edited-field', async page => {
    await open(page);
    await page.mouse.click(700, 592);
    await page.keyboard.press('F2');
    await expect(
        page.getByRole('textbox', {
            name: 'Field name',
        })
    ).toBeFocused();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('productName');
    await page.keyboard.press('Enter');
    await page.mouse.click(790, 680);
    await expect
        .poll(
            async () =>
                (await state(page)).model.cards.find(card => card.blockId === 'item')
                    ?.rows.length
        )
        .toBe(14);
    const next = await state(page);
    expect(rowName(next, 'item', 'product')).toBe('productName');
    expect(next.document.operations).toHaveLength(1);
    expect(next.model.cards.find(card => card.blockId === 'item')?.rowWindow.state).toBe(
        'complete'
    );

    return next.model.cards.find(card => card.blockId === 'item');
});

await scenario('host-federation-live-canvas', async page => {
    const manifest = await page.request.get('http://localhost:3010/mf-manifest.json');
    expect(manifest.ok()).toBe(true);
    expect(await manifest.text()).not.toContain('.hot-update.');
    await page.goto('http://localhost:3000/edit?demo=1');
    await settled(page);
    expect(await page.locator('.schema-editor canvas').count()).toBe(1);
    expect((await state(page)).model.cards.length).toBeGreaterThan(0);
    await page.screenshot({
        path: resolve(output, 'host-main.png'),
    });
    await page.screenshot({
        path: resolve(output, 'host-main-cards.png'),
        clip: references.main.crops.find(crop => crop.name === 'cards')!.actual,
    });
    await page.mouse.click(360, 162);
    await expect
        .poll(async () => (await state(page)).model.selection?.memberId)
        .toBe('id');

    const evidence = await page.evaluate(() => {
        type Share = {
            loaded: boolean;
            lib: unknown;
            from: string;
        };
        const instances = (
            window as unknown as {
                __FEDERATION__: {
                    __INSTANCES__: {
                        name: string;
                        shareScopeMap: {
                            default: {
                                react: Record<string, Share>;
                            };
                        };
                    }[];
                };
            }
        ).__FEDERATION__.__INSTANCES__;
        const host = instances.find(instance => instance.name === 'schema_host')!
            .shareScopeMap.default.react['19.2.0'];
        const remote = instances.find(instance => instance.name === 'schema_editor')!
            .shareScopeMap.default.react['19.2.0'];

        return {
            canvas: [
                ...document.querySelectorAll('canvas'),
            ].map(canvas => ({
                width: canvas.width,
                height: canvas.height,
                rect: canvas.getBoundingClientRect().toJSON(),
            })),
            react: {
                sameRecord: host === remote,
                sameLibrary: host.lib === remote.lib,
                loaded: host.loaded,
                from: host.from,
            },
        };
    });
    expect(evidence.react).toMatchObject({
        sameRecord: true,
        sameLibrary: true,
        loaded: true,
        from: 'schema_host',
    });

    return evidence;
});

await scenario('http-adapter-pages-save-rejection-retry', async page => {
    const requests: {
        method: string;
        url: string;
        headers: Record<string, string>;
        body: unknown;
    }[] = [];
    const writes: {
        clientMutationId: string;
        operations: unknown[];
    }[] = [];
    const snapshot = {
        resource: 'schema',
        id: 'http-orders',
        revision: 's1',
    };
    const member = (id: string, name: string) => ({
        member: {
            id,
            kind: 'property',
            name,
            required: true,
            valueNodeId: `value-${id}`,
        },
        valueSummary: {
            id: `value-${id}`,
            kind: 'scalar',
            label: 'string',
            directMemberCount: 0,
            descendantCount: 0,
        },
    });
    await page.route('**/api/v2/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        requests.push({
            method: request.method(),
            url: url.pathname + url.search,
            headers: request.headers(),
            body: request.postDataJSON(),
        });
        const json = (body: unknown, status = 200) =>
            route.fulfill({
                status,
                contentType: 'application/json',
                body: JSON.stringify(body),
            });

        if (url.pathname.endsWith('/manifest')) {
            return json({
                contractVersion: 2,
                format: 'schema-draft',
                snapshot,
                title: 'HTTP Orders',
                rootNodeId: 'root',
                profile: {
                    syntax: 'json',
                    dialect: 'json-schema-2020-12',
                },
            });
        }

        if (url.pathname.endsWith('/nodes/root')) {
            return json({
                id: 'root',
                kind: 'object',
                properties: {
                    id: 'fields',
                    totalItems: 2,
                },
                additionalProperties: false,
            });
        }

        if (url.pathname.endsWith('/collections/fields/items')) {
            return json({
                contractVersion: 2,
                snapshot,
                collectionId: 'fields',
                scopeId: null,
                items: url.searchParams.has('cursor')
                    ? [
                          member('name', 'name'),
                          member('second', 'second'),
                      ]
                    : [
                          member('name', 'name'),
                      ],
                totalItems: 2,
                nextCursor: url.searchParams.has('cursor') ? null : 'page-two',
            });
        }

        if (url.pathname.endsWith('/changesets') && request.method() === 'POST') {
            const body = request.postDataJSON() as {
                clientMutationId: string;
                operations: unknown[];
            };
            writes.push(body);

            if (writes.length === 1) {
                return json(
                    {
                        error: 'invalid-field',
                    },
                    422
                );
            }

            return json(
                {
                    id: 'change-two',
                    clientMutationId: body.clientMutationId,
                    status: 'pending',
                    result: null,
                },
                202
            );
        }

        if (url.pathname.endsWith('/changesets/change-two')) {
            return json({
                id: 'change-two',
                clientMutationId: writes.at(-1)!.clientMutationId,
                status: 'applied',
                result: {
                    revision: 's2',
                },
            });
        }

        return json(
            {
                error: 'unexpected-path',
            },
            404
        );
    });
    await page.goto('http://localhost:3000/edit?schemaId=http-orders&revision=s1');
    await settled(page);
    await page
        .getByRole('button', {
            name: 'Arrange',
            exact: true,
        })
        .click();
    await page.evaluate(
        () =>
            new Promise<void>(done =>
                requestAnimationFrame(() => requestAnimationFrame(() => done()))
            )
    );
    const clickMember = async () => {
        const value = await state(page);
        const card = value.geometry.cards.find(item => item.blockId === 'root')!;
        const row = card.rows.find(item => item.memberId === 'name')!;
        await page.mouse.click(
            (row.bounds.x + row.bounds.width / 2) * value.viewport.zoom +
                value.viewport.x,
            (row.bounds.y + row.bounds.height / 2) * value.viewport.zoom +
                value.viewport.y
        );
        await page.keyboard.press('F2');
        await expect(
            page.getByRole('textbox', {
                name: 'Field name',
            })
        ).toBeFocused();
        await page.keyboard.press('Control+A');
    };
    await clickMember();
    await page.keyboard.type('invalidName');
    await page.keyboard.press('Enter');
    await expect
        .poll(async () => rowName(await state(page), 'root', 'name'))
        .toBe('invalidName');
    const first = await state(page);
    const more = first.geometry.cards
        .find(item => item.blockId === 'root')!
        .regions.find(region => region.target.kind === 'more')!;
    await page.mouse.click(
        (more.bounds.x + more.bounds.width / 2) * first.viewport.zoom + first.viewport.x,
        (more.bounds.y + more.bounds.height / 2) * first.viewport.zoom + first.viewport.y
    );
    await expect
        .poll(async () => (await state(page)).model.cards[0]?.rows.length)
        .toBe(2);
    expect(rowName(await state(page), 'root', 'name')).toBe('invalidName');
    await page
        .getByRole('button', {
            name: 'Save schema',
            exact: true,
        })
        .click();
    await expect(page.getByRole('status')).toContainText('rejected');
    expect(rowName(await state(page), 'root', 'name')).toBe('invalidName');
    await clickMember();
    await page.keyboard.type('correctedName');
    await page.keyboard.press('Enter');
    await page
        .getByRole('button', {
            name: 'Save schema',
            exact: true,
        })
        .click();
    await expect.poll(async () => (await state(page)).document.revision).toBe('s2');
    expect(rowName(await state(page), 'root', 'name')).toBe('correctedName');
    expect(writes).toHaveLength(2);
    expect(writes[0].clientMutationId).not.toBe(writes[1].clientMutationId);
    expect(writes[1].operations).toHaveLength(2);
    expect(
        requests
            .filter(request => request.method === 'POST')
            .every(request => request.headers['if-match'] === '"http-orders:s1"')
    ).toBe(true);
    expect(requests.some(request => request.url.includes('/api/api/'))).toBe(false);
    expect(requests.some(request => request.url.endsWith('/changesets/change-two'))).toBe(
        true
    );

    return {
        requests,
        writes,
        final: await state(page),
        limitation:
            'Playwright HTTP route responses exercise the production HTTP adapter and controller, not backend persistence.',
    };
});

await scenario('public-mount-isolation-update-dispose', async page => {
    await page.goto('http://localhost:3000/edit?demo=1');
    await settled(page);
    await page.evaluate(async () => {
        const root = window as unknown as {
            schema_editor: {
                get(name: string): Promise<
                    () => {
                        mount(
                            element: HTMLElement,
                            props: unknown
                        ): {
                            update(props: unknown): void;
                            unmount(): void;
                        };
                    }
                >;
            };
            __mountTest?: {
                handles: {
                    update(props: unknown): void;
                    unmount(): void;
                }[];
                nodes: HTMLElement[];
            };
        };
        const { mount } = (await root.schema_editor.get('./mount'))();
        const nodes = [
            0,
            1,
        ].map(index => {
            const element = document.createElement('div');
            element.dataset.mountTest = String(index);
            Object.assign(element.style, {
                position: 'fixed',
                left: `${index * 720}px`,
                top: '0',
                width: '700px',
                height: '900px',
                zIndex: '10',
            });
            document.body.append(element);

            return element;
        });
        const handles = nodes.map((node, index) =>
            mount(node, {
                resource: {
                    kind: 'schema',
                    schemaId: `instance-${index}`,
                    revision: 'fixture-1',
                },
                apiBaseUrl: 'fixture://standalone',
            })
        );
        root.__mountTest = {
            handles,
            nodes,
        };
    });
    await expect(page.locator('[data-mount-test] canvas')).toHaveCount(2);
    await page.waitForFunction(() =>
        [
            ...document.querySelectorAll('[data-mount-test] canvas'),
        ].every(canvas => (canvas as HTMLCanvasElement).width > 0)
    );
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(
        () =>
            new Promise<void>(done =>
                requestAnimationFrame(() => requestAnimationFrame(() => done()))
            )
    );
    await page.mouse.click(360, 162);
    await page.keyboard.press('F2');
    await expect(page.locator('[data-mount-test="0"] [data-board-rename]')).toBeFocused();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('isolatedId');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-mount-test="0"]')).toContainText('isolatedId');
    await expect(page.locator('[data-mount-test="1"]')).not.toContainText('isolatedId');
    await page.mouse.click(360, 162);
    await page.keyboard.press('F2');
    await expect(page.locator('[data-mount-test="0"] [data-board-rename]')).toBeVisible();
    await page.evaluate(() => {
        const state = (
            window as unknown as {
                __mountTest: {
                    handles: {
                        update(props: unknown): void;
                        unmount(): void;
                    }[];
                };
            }
        ).__mountTest;
        state.handles[0].update({
            resource: {
                kind: 'schema',
                schemaId: 'replacement',
                revision: 'fixture-2',
            },
            apiBaseUrl: 'fixture://standalone',
        });
    });
    await expect(page.locator('[data-mount-test="0"] [data-board-rename]')).toHaveCount(
        0
    );
    await expect(page.locator('[data-mount-test="0"]')).not.toContainText('isolatedId');
    await page.evaluate(() => {
        (
            window as unknown as {
                __mountTest: {
                    handles: {
                        update(props: unknown): void;
                    }[];
                };
            }
        ).__mountTest.handles[0].update({
            resource: {
                kind: 'schema',
                schemaId: 'instance-0',
                revision: 'fixture-1',
            },
            apiBaseUrl: 'fixture://standalone',
        });
    });
    await expect(page.locator('[data-mount-test="0"]')).not.toContainText('isolatedId');
    await expect(page.locator('[data-mount-test="0"]')).not.toContainText(
        'Save 1 changes'
    );
    const result = await page.evaluate(async () => {
        const root = window as unknown as {
            schema_editor: {
                get(name: string): Promise<
                    () => {
                        mount(
                            element: HTMLElement,
                            props: unknown
                        ): {
                            unmount(): void;
                        };
                    }
                >;
            };
            __mountTest: {
                handles: {
                    unmount(): void;
                }[];
                nodes: HTMLElement[];
            };
        };
        root.__mountTest.handles.forEach(handle => {
            handle.unmount();
            handle.unmount();
        });
        const remainingCanvas = root.__mountTest.nodes.reduce(
            (count, node) => count + node.querySelectorAll('canvas').length,
            0
        );
        const { mount } = (await root.schema_editor.get('./mount'))();

        for (let index = 0; index < 10; index += 1) {
            const handle = mount(root.__mountTest.nodes[0], {
                resource: {
                    kind: 'schema',
                    schemaId: `dispose-${index}`,
                },
                apiBaseUrl: 'fixture://standalone',
            });
            handle.unmount();
        }

        return {
            remainingCanvas,
            nativeInputs: document.querySelectorAll(
                '[data-mount-test] [data-board-rename]'
            ).length,
        };
    });
    expect(result).toEqual({
        remainingCanvas: 0,
        nativeInputs: 0,
    });

    return result;
});

await scenario(
    'remote-unavailable-retry',
    async page => {
        await page.route('**/remoteEntry.js', route => route.abort('failed'));
        await page.goto('http://localhost:3000/edit?demo=1');
        await expect(
            page.getByRole('heading', {
                name: 'Editor could not load',
            })
        ).toBeVisible();
        await expect(
            page.locator('iframe#webpack-dev-server-client-overlay')
        ).toHaveCount(0);
        await page.screenshot({
            path: resolve(output, 'remote-unavailable.png'),
        });
        await page.unroute('**/remoteEntry.js');
        await page
            .getByRole('button', {
                name: 'Try again',
            })
            .click();
        await settled(page);
        expect((await state(page)).model.cards).toHaveLength(6);

        return {
            recovered: true,
            visibleCards: (await state(page)).stats,
        };
    },
    /Failed to load script resources|RUNTIME-008/
);

await scenario('public-mount-during-font-loading', async page => {
    await page.goto('http://localhost:3000/edit?demo=1');
    await settled(page);
    let releaseFont: () => void = () => undefined;
    const held = new Promise<void>(done => {
        releaseFont = done;
    });
    const font = await readFile('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf');
    await page.route('**/verifier-slow-font.ttf', async route => {
        await held;
        await route.fulfill({
            status: 200,
            contentType: 'font/ttf',
            body: font,
        });
    });
    await page.evaluate(async () => {
        const root = window as unknown as {
            schema_editor: {
                get(name: string): Promise<
                    () => {
                        mount(
                            node: HTMLElement,
                            props: unknown
                        ): {
                            unmount(): void;
                        };
                    }
                >;
            };
            __fontTest?: {
                handle: {
                    unmount(): void;
                };
                node: HTMLElement;
                label: HTMLElement;
            };
        };
        const face = new FontFace(
            'Verifier Slow Font',
            'url(http://localhost:3000/verifier-slow-font.ttf)'
        );
        document.fonts.add(face);
        const label = document.createElement('span');
        label.textContent = 'Deferred font';
        label.style.fontFamily = 'Verifier Slow Font';
        document.body.append(label);
        void document.fonts.load('16px "Verifier Slow Font"');
        const node = document.createElement('div');
        node.dataset.fontMount = 'true';
        Object.assign(node.style, {
            position: 'fixed',
            inset: '0',
            zIndex: '10',
        });
        document.body.append(node);
        const { mount } = (await root.schema_editor.get('./mount'))();
        root.__fontTest = {
            handle: mount(node, {
                resource: {
                    kind: 'schema',
                    schemaId: 'font-pending',
                },
                apiBaseUrl: 'fixture://standalone',
            }),
            node,
            label,
        };
    });
    await page.waitForFunction(
        () =>
            document.fonts.status === 'loading' &&
            document.querySelector('[data-font-mount] .schema-editor') !== null
    );
    await page.evaluate(
        () =>
            new Promise<void>(done =>
                requestAnimationFrame(() => requestAnimationFrame(() => done()))
            )
    );
    expect(await page.locator('[data-font-mount] canvas').count()).toBe(0);
    await page.evaluate(() => {
        const test = (
            window as unknown as {
                __fontTest: {
                    handle: {
                        unmount(): void;
                    };
                };
            }
        ).__fontTest;
        test.handle.unmount();
        test.handle.unmount();
    });
    releaseFont();
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(
        () =>
            new Promise<void>(done =>
                requestAnimationFrame(() => requestAnimationFrame(() => done()))
            )
    );
    expect(await page.locator('[data-font-mount] canvas').count()).toBe(0);
    expect(await page.locator('[data-font-mount] [data-board-rename]').count()).toBe(0);

    return {
        disposedBeforeFontReady: true,
        resurrectedCanvas: false,
    };
});

await scenario('http-api-unavailable-error', async page => {
    await page.route('**/api/v2/**', route =>
        route.fulfill({
            status: 404,
            contentType: 'application/json',
            body: '{}',
        })
    );
    await page.goto('http://localhost:3000/edit?schemaId=absent&revision=s1');
    await expect(page.getByRole('alert')).toContainText('requires API v2');
    expect((await state(page)).ready).toBe(false);
    expect((await state(page)).model.cards).toHaveLength(0);

    return {
        alert: await page.getByRole('alert').innerText(),
    };
});

await scenario('host-style-isolation-public-mount', async page => {
    await page.goto('http://localhost:3000/');
    await page.evaluate(() => document.fonts.ready);
    const styles = async () =>
        page.evaluate(() =>
            [
                'body',
                '.App',
                'h1',
                'button',
                'a',
            ].map(selector => {
                const element = document.querySelector(selector);

                if (!element) {
                    return {
                        selector,
                        missing: true,
                    };
                }

                const computed = getComputedStyle(element);

                return {
                    selector,
                    font: computed.font,
                    color: computed.color,
                    background: computed.backgroundColor,
                    margin: computed.margin,
                    padding: computed.padding,
                    border: computed.border,
                    rect: element.getBoundingClientRect().toJSON(),
                };
            })
        );
    const before = await styles();
    const beforeImage = await page.screenshot({
        path: resolve(output, 'host-before-mount.png'),
    });
    await page.addScriptTag({
        url: 'http://localhost:3010/remoteEntry.js',
    });
    await page.evaluate(async () => {
        type Handle = {
            unmount(): void;
        };
        const root = window as unknown as {
            __FEDERATION__: {
                __INSTANCES__: {
                    name: string;
                    shareScopeMap: {
                        default: unknown;
                    };
                }[];
            };
            schema_editor: {
                init(scope: unknown): Promise<void>;
                get(name: string): Promise<
                    () => {
                        mount(element: HTMLElement, props: unknown): Handle;
                    }
                >;
            };
            __styleTest?: {
                handle: Handle;
                node: HTMLElement;
            };
        };
        const host = root.__FEDERATION__.__INSTANCES__.find(
            instance => instance.name === 'schema_host'
        )!;
        await root.schema_editor.init(host.shareScopeMap.default);
        const { mount } = (await root.schema_editor.get('./mount'))();
        const node = document.createElement('div');
        Object.assign(node.style, {
            position: 'fixed',
            inset: '0',
            zIndex: '10',
        });
        document.body.append(node);
        const handle = mount(node, {
            resource: {
                kind: 'schema',
                schemaId: 'styles',
            },
            apiBaseUrl: 'fixture://standalone',
        });
        root.__styleTest = {
            handle,
            node,
        };
    });
    await settled(page);
    const during = await styles();
    expect(during).toEqual(before);
    await page.evaluate(() => {
        const test = (
            window as unknown as {
                __styleTest: {
                    handle: {
                        unmount(): void;
                    };
                    node: HTMLElement;
                };
            }
        ).__styleTest;
        test.handle.unmount();
        test.node.remove();
    });
    const after = await styles();
    expect(after).toEqual(before);
    const afterImage = await page.screenshot({
        path: resolve(output, 'host-after-mount.png'),
    });
    expect(afterImage.equals(beforeImage)).toBe(true);

    return {
        before,
        during,
        after,
        screenshotIdentical: true,
    };
});

await context.close();
await writeFile(
    resolve(output, 'results.json'),
    JSON.stringify(
        {
            browser: browser.version(),
            node: process.version,
            results,
        },
        (_key, value) => (typeof value === 'function' ? '[function]' : value),
        2
    )
);
await browser.close();
