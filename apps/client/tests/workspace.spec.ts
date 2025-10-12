import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';

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

test('recovers after runtime configuration fails once', async ({ page }, testInfo) => {
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => {
        if (message.type() === 'error') {
            consoleErrors.push(message.text());
        }
    });
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
    expect(pageErrors).toEqual([]);
    expect(
        consoleErrors.filter(
            error =>
                !/The editor runtime configuration is unavailable\./.test(error) &&
                !/Failed to load resource: the server responded with a status of 503/.test(error)
        )
    ).toEqual([]);
});
