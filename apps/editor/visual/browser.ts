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
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
});
await context.addInitScript('globalThis.__name = (value) => value;');
const results: unknown[] = [];
const requested = process.argv.slice(2);

function state(page: Page): Promise<State> {
    return page.evaluate(() =>
        (
            window as unknown as { __editorPlayground: { read(): State } }
        ).__editorPlayground.read()
    );
}

async function settled(page: Page): Promise<void> {
    await page.waitForFunction(() => {
        const value = (
            window as unknown as { __editorPlayground?: { read(): State } }
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
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    let evidence: unknown;

    try {
        evidence = await action(page);
        expect(errors.filter(error => !expectedError?.test(error))).toEqual([]);
        await page.screenshot({ path: resolve(output, `${name}.png`) });
        results.push({ name, passed: true, evidence, errors, consoleErrors });
        console.log(`PASS ${name}`);
    } catch (error) {
        await page.screenshot({ path: resolve(output, `${name}-failure.png`) });
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
        await context.tracing.stop({ path: resolve(output, `${name}-trace.zip`) });
        await page.close();
    }
}

await scenario('selection-rename-history', async page => {
    await open(page);
    const before = await state(page);
    const order = before.geometry.cards.find(card => card.blockId === 'order')!;
    expect(order.bounds).toEqual({ x: 300, y: 110, width: 248, height: 182 });
    expect(order.rows[0].bounds).toEqual({ x: 304, y: 148, width: 240, height: 28 });
    await page.mouse.click(360, 162);
    await expect
        .poll(async () => (await state(page)).model.selection)
        .toEqual({ blockId: 'order', memberId: 'id' });
    await expect(page.getByRole('treeitem', { selected: true })).toHaveCount(1);
    await page.keyboard.press('F2');
    const input = page.getByRole('textbox', { name: 'Field name' });
    await expect(input).toBeFocused();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('orderId');
    await page.keyboard.press('Enter');
    await expect
        .poll(async () => rowName(await state(page), 'order', 'id'))
        .toBe('orderId');
    expect((await state(page)).document.operations).toHaveLength(1);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(async () => rowName(await state(page), 'order', 'id')).toBe('id');
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
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

    return { initialGeometry: order, finalDocument: (await state(page)).document };
});

await scenario('camera-pan-cursor-zoom', async page => {
    await open(page);
    await page.mouse.move(970, 720);
    await page.mouse.down();
    await page.mouse.move(1010, 750, { steps: 8 });
    await page.mouse.up();
    await expect
        .poll(async () => (await state(page)).viewport)
        .toEqual({ x: 40, y: 30, zoom: 1 });
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

    return { before, after };
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
    const input = page.getByRole('textbox', { name: 'Field name' });
    await expect(input).toBeFocused();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('поле');
    await input.dispatchEvent('compositionstart', { data: 'поле' });
    await page.keyboard.press('Enter');
    await expect(input).toBeVisible();
    expect((await state(page)).document.operations).toHaveLength(0);
    await input.dispatchEvent('compositionend', { data: 'поле' });
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
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: 970, y: 720, id: 1 }],
    });
    await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: 1010, y: 750, id: 1 }],
    });
    await expect.poll(async () => (await state(page)).viewport.x).toBe(40);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    expect((await state(page)).viewport).toEqual({ x: 0, y: 0, zoom: 1 });
    await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [
            { x: 940, y: 720, id: 1 },
            { x: 1040, y: 720, id: 2 },
        ],
    });
    await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
            { x: 920, y: 700, id: 1 },
            { x: 1060, y: 740, id: 2 },
        ],
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
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
    await page.mouse.move(978, 726, { steps: 4 });
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

    return { before: before.stats, after: after.stats };
});

await scenario('card-drag-cancel-edges', async page => {
    await open(page);
    await page.mouse.move(400, 130);
    await page.mouse.down();
    await page.mouse.move(440, 180, { steps: 10 });
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
    ).toEqual({ x: 588, y: 240 });
    expect(moved.document.operations).toHaveLength(0);
    await page.mouse.move(440, 180);
    await page.mouse.down();
    await page.mouse.move(480, 230, { steps: 8 });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(
        (await state(page)).geometry.cards.find(card => card.blockId === 'order')?.bounds
    ).toEqual({ x: 340, y: 160, width: 248, height: 182 });
    expect((await state(page)).document.operations).toHaveLength(0);

    return { movedGeometry: moved.geometry };
});

await scenario('member-transfer-undo', async page => {
    await open(page);
    await page.mouse.move(365, 274);
    await page.mouse.down();
    await page.mouse.move(700, 132, { steps: 12 });
    await page.mouse.up();
    await expect
        .poll(async () => rowName(await state(page), 'customer', 'delivery'))
        .toBe('delivery');
    expect(rowName(await state(page), 'order', 'delivery')).toBeUndefined();
    expect((await state(page)).document.operations).toHaveLength(1);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
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
    await page.mouse.move(365, 178, { steps: 12 });
    await page.mouse.up();
    await expect
        .poll(async () =>
            (await state(page)).model.cards
                .find(card => card.blockId === 'order')
                ?.rows.map(row => row.memberId)
        )
        .toEqual(['id', 'delivery', 'customer', 'payment', 'items']);
    const next = await state(page);
    expect(
        next.geometry.connections.find(edge => edge.id === 'order/customer/customer')
            ?.source
    ).toEqual({ x: 548, y: 218 });
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
    ).toEqual({ x: 620, y: 90, width: 238, height: 154 });
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
    await expect(page.getByRole('textbox', { name: 'Field name' })).toBeFocused();
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

await context.close();
await writeFile(
    resolve(output, 'results.json'),
    JSON.stringify(
        { browser: browser.version(), node: process.version, results },
        (_key, value) => (typeof value === 'function' ? '[function]' : value),
        2
    )
);
await browser.close();
