import { chromium, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cpus, platform, release } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getScene, sceneIds, type SceneId } from '../playground/scenes';
import type { ReferenceCrop } from '../playground/references';
import { tokens } from '../src/board/theme';
import { ensureEditorServer } from './server';
import type { BoardGeometry, BoardModel, BoardViewport } from '../src/board';

const editorRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = resolve(editorRoot, '../..');
const output = resolve(editorRoot, 'visual/actual');
const compareOutput = resolve(editorRoot, 'visual/compare');
const designRoot =
    process.env.EDITOR_DESIGN_ROOT ??
    resolve(workspaceRoot, 'artifacts/schema-editor-design');
const baseUrl = process.env.EDITOR_URL ?? 'http://127.0.0.1:3010';
const names =
    process.argv.slice(2).length > 0
        ? process.argv.slice(2)
        : [
              'main',
              'variants',
              'replace-preview',
              'card-anatomy',
              'loading',
              'lod',
              'builder',
          ];
const launchArgs = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'];

type Diagnostics = {
    ready: boolean;
    scene: string;
    stats: { renderedFrames: number };
    model: BoardModel;
    geometry: BoardGeometry;
    viewport: BoardViewport;
};

async function diagnostic(page: Page): Promise<Diagnostics> {
    return page.evaluate(() =>
        (
            window as unknown as { __editorPlayground: { read(): Diagnostics } }
        ).__editorPlayground.read()
    );
}

async function fieldPoint(
    page: Page,
    blockId: string,
    memberId: string,
    fraction = 0.5
): Promise<{ x: number; y: number }> {
    const value = await diagnostic(page);
    const row = value.geometry.cards
        .find(card => card.blockId === blockId)
        ?.rows.find(row => row.memberId === memberId);

    if (!row) {
        throw new Error(
            `Fixture field is outside the rendered window: ${blockId}/${memberId}`
        );
    }

    return {
        x: (row.bounds.x + row.bounds.width / 2) * value.viewport.zoom + value.viewport.x,
        y:
            (row.bounds.y + row.bounds.height * fraction) * value.viewport.zoom +
            value.viewport.y,
    };
}

async function ready(page: Page): Promise<void> {
    await page.waitForFunction(
        () => {
            const diagnostic = (
                window as unknown as { __editorPlayground?: { read(): Diagnostics } }
            ).__editorPlayground?.read();

            return diagnostic?.ready === true && diagnostic.stats.renderedFrames > 0;
        },
        null,
        { timeout: 30000 }
    );
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(
        () =>
            new Promise<void>(done =>
                requestAnimationFrame(() => requestAnimationFrame(() => done()))
            )
    );
}

async function compare(
    page: Page,
    name: string,
    actualFile: string,
    referenceFile: string,
    crop: ReferenceCrop
): Promise<unknown> {
    const actual = `data:image/png;base64,${(await readFile(actualFile)).toString('base64')}`;
    const reference = `data:image/png;base64,${(await readFile(referenceFile)).toString('base64')}`;
    await page.setContent('<body style="margin:0"><canvas></canvas></body>');
    const result = await page.evaluate(
        async ({ actual, reference, crop, colors }) => {
            const load = async (src: string) => {
                const image = new Image();
                image.src = src;
                await image.decode();

                return image;
            };
            const [a, b] = await Promise.all([load(actual), load(reference)]);
            const width = Math.round(crop.actual.width * 2);
            const height = Math.round(crop.actual.height * 2);
            const make = (image: HTMLImageElement, bounds: ReferenceCrop['actual']) => {
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const context = canvas.getContext('2d')!;
                context.drawImage(
                    image,
                    bounds.x * 2,
                    bounds.y * 2,
                    bounds.width * 2,
                    bounds.height * 2,
                    0,
                    0,
                    width,
                    height
                );

                return {
                    canvas,
                    context,
                    pixels: context.getImageData(0, 0, width, height),
                };
            };
            const left = make(b, crop.reference);
            const right = make(a, crop.actual);
            const diff = new ImageData(width, height);
            let changedPixels = 0;
            let absoluteError = 0;

            for (let index = 0; index < diff.data.length; index += 4) {
                let maximum = 0;

                for (let channel = 0; channel < 3; channel += 1) {
                    const delta = Math.abs(
                        left.pixels.data[index + channel] -
                            right.pixels.data[index + channel]
                    );
                    maximum = Math.max(maximum, delta);
                    absoluteError += delta;
                    diff.data[index + channel] = delta;
                }

                diff.data[index + 3] = 255;

                if (maximum > 24) {
                    changedPixels += 1;
                }
            }

            const canvas = document.querySelector('canvas')!;
            canvas.width = width * 3;
            canvas.height = height + 32;
            const context = canvas.getContext('2d')!;
            context.fillStyle = colors.background;
            context.fillRect(0, 0, canvas.width, canvas.height);
            context.fillStyle = colors.label;
            context.font = '20px sans-serif';
            context.fillText('Design reference', 8, 24);
            context.fillText('Actual editor', width + 8, 24);
            context.fillText('Absolute pixel difference', width * 2 + 8, 24);
            context.drawImage(left.canvas, 0, 32);
            context.drawImage(right.canvas, width, 32);
            context.putImageData(diff, width * 2, 32);

            return {
                png: canvas.toDataURL('image/png').split(',')[1],
                changedPixels,
                totalPixels: width * height,
                changedFraction: changedPixels / (width * height),
                meanAbsoluteChannelError: absoluteError / (width * height * 3),
                referenceSize: { width: b.naturalWidth, height: b.naturalHeight },
                actualSize: { width: a.naturalWidth, height: a.naturalHeight },
            };
        },
        {
            actual,
            reference,
            crop,
            colors: {
                background: tokens.color['surface-card'],
                label: tokens.color.label,
            },
        }
    );
    const { png, ...statistics } = result;
    const comparisonFile = resolve(compareOutput, `${name}-${crop.name}.png`);
    await writeFile(comparisonFile, Buffer.from(png, 'base64'));

    return {
        crop,
        actualFile,
        referenceFile,
        comparisonFile,
        ...statistics,
        reviewed: false,
    };
}

await mkdir(output, { recursive: true });
await mkdir(compareOutput, { recursive: true });

const server = await ensureEditorServer(baseUrl);
const browser = await chromium.launch({ headless: true, args: launchArgs });
const results: unknown[] = [];

try {
    if (browser.version() !== '141.0.7390.37') {
        throw new Error(
            `Expected Playwright 1.56.1 Chromium 141.0.7390.37; received ${browser.version()}`
        );
    }

    const context = await browser.newContext({
        deviceScaleFactor: 2,
        reducedMotion: 'reduce',
    });
    await context.addInitScript('globalThis.__name = (value) => value;');

    for (const name of names) {
        if (!sceneIds.includes(name as SceneId)) {
            throw new Error(`Unknown scene: ${name}`);
        }

        const scene = getScene(name);
        const page = await context.newPage();
        const errors: string[] = [];
        const consoleErrors: string[] = [];
        page.on('pageerror', error => errors.push(String(error)));
        page.on('console', message => {
            if (message.type() === 'error') {
                consoleErrors.push(message.text());
            }
        });
        await page.setViewportSize(scene.viewport);
        await context.tracing.start({
            screenshots: true,
            snapshots: true,
            sources: true,
        });

        try {
            await page.goto(`${baseUrl}/?scene=${encodeURIComponent(scene.id)}`);
            await ready(page);
            if (scene.id === 'card-anatomy') {
                const hover = await fieldPoint(page, 'state-hover', 'hover');
                await page.mouse.move(hover.x, hover.y);
            }

            const initialDiagnostic = await diagnostic(page);
            const environment = await page.evaluate(() => {
                const gl = document.createElement('canvas').getContext('webgl2');
                const extension = gl?.getExtension('WEBGL_debug_renderer_info');

                return {
                    dpr: devicePixelRatio,
                    fonts: [...document.fonts].map(font => ({
                        family: font.family,
                        status: font.status,
                    })),
                    graphics:
                        gl && extension
                            ? {
                                  vendor: gl.getParameter(
                                      extension.UNMASKED_VENDOR_WEBGL
                                  ),
                                  renderer: gl.getParameter(
                                      extension.UNMASKED_RENDERER_WEBGL
                                  ),
                              }
                            : null,
                };
            });

            if (!environment.graphics) {
                throw new Error('WebGL2 unavailable; visual coverage failed');
            }

            const actualFile = resolve(output, `${scene.id}.png`);
            await page.screenshot({ path: actualFile, fullPage: false });

            if (errors.length > 0) {
                process.exitCode = 1;
            }

            const comparisons = [];

            if (scene.referenceFile) {
                const comparePage = await context.newPage();

                for (const crop of scene.crops) {
                    let cropFile = actualFile;

                    if (scene.id === 'card-anatomy' && crop.name === 'renaming') {
                        const point = await fieldPoint(
                            page,
                            'renaming',
                            'renaming-title'
                        );
                        await page.mouse.click(point.x, point.y);
                        await page.keyboard.press('F2');
                        await page
                            .getByRole('textbox', { name: 'Field name' })
                            .waitFor({ state: 'visible' });
                        await page.keyboard.press('Control+A');
                        await page.keyboard.type('net_weight');
                        await ready(page);
                        cropFile = resolve(output, `${scene.id}-renaming.png`);
                        await page.screenshot({ path: cropFile, fullPage: false });
                        await page.keyboard.press('Escape');
                    }

                    if (scene.id === 'card-anatomy' && crop.name === 'reordering') {
                        const from = await fieldPoint(
                            page,
                            'reordering',
                            'reorder-weight'
                        );
                        const to = await fieldPoint(
                            page,
                            'reordering',
                            'reorder-title',
                            0.1
                        );
                        await page.mouse.move(from.x, from.y);
                        await page.mouse.down();
                        await page.mouse.move(to.x, to.y, { steps: 12 });
                        await ready(page);
                        cropFile = resolve(output, `${scene.id}-reordering.png`);
                        await page.screenshot({ path: cropFile, fullPage: false });
                        await page.keyboard.press('Escape');
                        await page.mouse.up();
                    }

                    comparisons.push(
                        await compare(
                            comparePage,
                            scene.id,
                            cropFile,
                            resolve(
                                designRoot,
                                'screens/png',
                                `${scene.referenceFile}.png`
                            ),
                            crop
                        )
                    );
                }

                await comparePage.close();
            }

            results.push({
                scene: scene.id,
                viewport: scene.viewport,
                actualFile,
                diagnostic: initialDiagnostic,
                environment,
                errors,
                consoleErrors,
                comparisons,
            });
            console.log(
                `${scene.id}: captured ${comparisons.length} comparisons; page errors ${errors.length}`
            );
        } catch (error) {
            await page.screenshot({
                path: resolve(output, `${scene.id}-failure.png`),
                fullPage: false,
            });
            results.push({
                scene: scene.id,
                failure: String(error),
                errors,
                consoleErrors,
            });
            process.exitCode = 1;
            console.error(`${scene.id}: ${String(error)}`);
        } finally {
            await context.tracing.stop({
                path: resolve(output, `${scene.id}-trace.zip`),
            });
            await page.close();
        }
    }

    await context.close();
} finally {
    await writeFile(
        resolve(output, 'results.json'),
        JSON.stringify(
            {
                browser: browser.version(),
                node: process.version,
                os: { platform: platform(), release: release(), cpu: cpus()[0]?.model },
                launchArgs,
                results,
            },
            null,
            2
        )
    );
    await browser.close();
    await server.stop();
}
