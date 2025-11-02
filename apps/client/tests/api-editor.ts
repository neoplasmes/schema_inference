import { expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

type Bounds = {
    x: number;
    y: number;
    width: number;
    height: number;
};
type EditorState = {
    ready: boolean;
    stats: {
        renderedFrames: number;
    };
    model: {
        state: string;
        version: number;
        cards: {
            blockId: string;
            rows: {
                memberId: string;
                name: string;
                expandable: boolean;
            }[];
        }[];
        connections: {
            sourceMemberId: string;
            targetBlockId: string;
        }[];
    };
    geometry: {
        version: number;
        cards: {
            rows: {
                memberId: string;
                bounds: Bounds;
                nameBounds?: Bounds;
            }[];
        }[];
    };
    viewport: {
        x: number;
        y: number;
        zoom: number;
    };
    document: {
        revision: string;
        operations: unknown[];
    };
};

export async function state(page: Page): Promise<EditorState> {
    return page.evaluate(() => {
        const editor = (
            window as Window & {
                __editorPlayground?: {
                    read(): EditorState;
                };
            }
        ).__editorPlayground;

        if (!editor) {
            throw new Error('Editor is not mounted.');
        }

        return editor.read();
    });
}

export async function ready(page: Page): Promise<void> {
    await expect
        .poll(async () => {
            const value = await state(page).catch(() => undefined);

            return (
                value?.ready &&
                value.model.state === 'ready' &&
                value.model.version === value.geometry.version &&
                value.stats.renderedFrames > 0 &&
                value.geometry.cards.length > 0
            );
        }, {
            timeout: 30000,
        })
        .toBe(true);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.evaluate(
        () =>
            new Promise<void>(resolve =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
            )
    );
    await expect(page.locator('.schema-editor canvas')).toHaveCount(1);
}

export async function names(page: Page): Promise<string[]> {
    return (await state(page)).model.cards.flatMap(card =>
        card.rows.map(row => row.name)
    );
}

export async function recordJson(testInfo: TestInfo, name: string, value: unknown): Promise<void> {
    const path = testInfo.outputPath(`${name}.json`);
    await writeFile(path, JSON.stringify(value, null, 2));
    await testInfo.attach(name, {
        path,
        contentType: 'application/json',
    });
}

export async function capture(page: Page, testInfo: TestInfo, name: string): Promise<void> {
    await ready(page);
    const path = testInfo.outputPath(`${name}.png`);
    await page.screenshot({
        path,
        fullPage: true,
    });
    await testInfo.attach(name, {
        path,
        contentType: 'image/png',
    });
    await recordJson(testInfo, `${name}-state`, await state(page));
}

export async function expand(page: Page, name: string): Promise<void> {
    const before = await state(page);
    const row = before.model.cards.flatMap(card => card.rows).find(row => row.name === name);
    expect(row?.expandable).toBe(true);
    const treeItem = page.getByRole('treeitem', {
        name: new RegExp(`\\b${name}\\b`),
    });
    await treeItem.click();
    await treeItem.press('ArrowRight');
    await expect
        .poll(async () => (await state(page)).model.cards.length)
        .toBe(before.model.cards.length + 1);
    await ready(page);
    const after = await state(page);
    const connection = after.model.connections.find(
        connection => connection.sourceMemberId === row!.memberId
    );
    expect(connection).toBeDefined();
    expect(after.model.cards.find(card => card.blockId === connection!.targetBlockId))
        .toBeDefined();
    expect(after.document.operations).toEqual(before.document.operations);
}

export async function rename(page: Page): Promise<void> {
    await expect.poll(() => names(page)).toContain('name');
    const current = await state(page);
    const member = current.model.cards
        .flatMap(card => card.rows)
        .find(row => row.name === 'name')!;
    const row = current.geometry.cards
        .flatMap(card => card.rows)
        .find(item => item.memberId === member.memberId)!;
    const canvas = await page.locator('.schema-editor canvas').boundingBox();
    const bounds = row.nameBounds ?? row.bounds;
    await page.mouse.dblclick(
        canvas!.x +
            current.viewport.x +
            (bounds.x + bounds.width / 2) * current.viewport.zoom,
        canvas!.y +
            current.viewport.y +
            (bounds.y + bounds.height / 2) * current.viewport.zoom
    );
    await expect(
        page.getByRole('textbox', {
            name: 'Field name',
            exact: true,
        })
    ).toBeFocused();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('customerName');
    await page.keyboard.press('Enter');
    await expect.poll(() => names(page)).toContain('customerName');
    expect(await names(page)).not.toContain('name');
}
