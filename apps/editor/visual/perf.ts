import { chromium, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, platform, release, totalmem } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureEditorServer } from './server';

type Frame = { time: number; cpuSubmitMs: number; drawCalls: number };
type Resource = { created: number; deleted: number; live: number };
type Probe = {
    frames: Frame[];
    resources: Record<string, Resource>;
    inputTimes: number[];
    inputToDrawMs: number[];
    rafCallbacks: number;
    pendingInput: number | null;
};
type Diagnostic = {
    scene: string;
    ready: boolean;
    model: { cards: { rows: unknown[] }[]; connections: unknown[] };
    viewport: { x: number; y: number; zoom: number };
    stats: {
        renderedFrames: number;
        visibleCards: number;
        visibleConnections: number;
        textObjects: number;
        lod: string;
    };
};
type SummaryState = Pick<Diagnostic, 'scene' | 'ready' | 'viewport' | 'stats'> & {
    loadedCards: number;
    loadedConnections: number;
    loadedRows: number;
};
type BrowserWindow = Window & {
    __editorPerf: Probe;
    __editorPlayground: { read(): Diagnostic };
};

const directory = dirname(fileURLToPath(import.meta.url));
const output = resolve(directory, 'actual/perf');
const baseUrl = process.env.EDITOR_URL ?? 'http://127.0.0.1:3010';
const scenes =
    process.argv.slice(2).length > 0
        ? process.argv.slice(2)
        : ['stress', 'dense', 'paged'];
const launchArgs = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'];

function distribution(values: number[]): {
    count: number;
    median: number | null;
    p95: number | null;
    maximum: number | null;
} {
    const sorted = [...values].sort((a, b) => a - b);
    const percentile = (fraction: number) =>
        sorted.length
            ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]
            : null;

    return {
        count: sorted.length,
        median: percentile(0.5),
        p95: percentile(0.95),
        maximum: sorted.at(-1) ?? null,
    };
}

function summarize(probe: Probe): unknown {
    return {
        actualDrawFrames: probe.frames.length,
        frameIntervalsMs: distribution(
            probe.frames
                .slice(1)
                .map((frame, index) => frame.time - probe.frames[index].time)
        ),
        cpuSubmissionMs: distribution(probe.frames.map(frame => frame.cpuSubmitMs)),
        drawCallsPerFrame: distribution(probe.frames.map(frame => frame.drawCalls)),
        inputToDrawMs: distribution(probe.inputToDrawMs),
        inputEvents: probe.inputTimes.length,
        rafCallbacks: probe.rafCallbacks,
        resources: probe.resources,
    };
}

function installProbe(): void {
    const root = window as unknown as BrowserWindow;
    const probe: Probe = {
        frames: [],
        resources: {},
        inputTimes: [],
        inputToDrawMs: [],
        rafCallbacks: 0,
        pendingInput: null,
    };
    root.__editorPerf = probe;
    let drawCalls = 0;
    const nativeRaf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback =>
        nativeRaf(time => {
            const before = drawCalls;
            const started = performance.now();
            probe.rafCallbacks += 1;
            callback(time);

            if (drawCalls > before) {
                const ended = performance.now();
                probe.frames.push({
                    time: started,
                    cpuSubmitMs: ended - started,
                    drawCalls: drawCalls - before,
                });

                if (probe.pendingInput !== null) {
                    probe.inputToDrawMs.push(ended - probe.pendingInput);
                    probe.pendingInput = null;
                }
            }
        });

    for (const event of ['pointermove', 'wheel']) {
        window.addEventListener(
            event,
            () => {
                const time = performance.now();
                probe.inputTimes.push(time);
                probe.pendingInput ??= time;
            },
            { capture: true, passive: true }
        );
    }

    for (const prototype of [
        WebGLRenderingContext.prototype,
        WebGL2RenderingContext.prototype,
    ]) {
        const methods = prototype as unknown as Record<
            string,
            (...arguments_: unknown[]) => unknown
        >;

        for (const name of [
            'drawArrays',
            'drawElements',
            'drawArraysInstanced',
            'drawElementsInstanced',
        ]) {
            if (!Object.hasOwn(prototype, name)) {
                continue;
            }

            const original = methods[name];
            methods[name] = function (...arguments_: unknown[]) {
                drawCalls += 1;

                return original.apply(this, arguments_);
            };
        }

        for (const kind of [
            'Texture',
            'Buffer',
            'Framebuffer',
            'Renderbuffer',
            'Program',
            'Shader',
            'VertexArray',
        ]) {
            const create = `create${kind}`;
            const remove = `delete${kind}`;

            if (!Object.hasOwn(prototype, create) || !Object.hasOwn(prototype, remove)) {
                continue;
            }

            const originalCreate = methods[create];
            const originalDelete = methods[remove];
            const live = new WeakSet<object>();
            const count = (probe.resources[kind] ??= { created: 0, deleted: 0, live: 0 });
            methods[create] = function (...arguments_: unknown[]) {
                const resource = originalCreate.apply(this, arguments_);

                if (resource && typeof resource === 'object') {
                    live.add(resource);
                    count.created += 1;
                    count.live += 1;
                }

                return resource;
            };
            methods[remove] = function (...arguments_: unknown[]) {
                const resource = arguments_[0];

                if (resource && typeof resource === 'object' && live.has(resource)) {
                    live.delete(resource);
                    count.deleted += 1;
                    count.live -= 1;
                }

                return originalDelete.apply(this, arguments_);
            };
        }
    }
}

async function state(page: Page): Promise<SummaryState> {
    return page.evaluate(() => {
        const value = (window as unknown as BrowserWindow).__editorPlayground.read();

        return {
            scene: value.scene,
            ready: value.ready,
            viewport: value.viewport,
            stats: value.stats,
            loadedCards: value.model.cards.length,
            loadedConnections: value.model.connections.length,
            loadedRows: value.model.cards.reduce(
                (count, card) => count + card.rows.length,
                0
            ),
        };
    });
}

async function reset(page: Page): Promise<void> {
    await page.evaluate(() => {
        const probe = (window as unknown as BrowserWindow).__editorPerf;
        probe.frames = [];
        probe.inputTimes = [];
        probe.inputToDrawMs = [];
        probe.rafCallbacks = 0;
        probe.pendingInput = null;
    });
}

async function sample(page: Page): Promise<Probe> {
    return page.evaluate(() =>
        structuredClone((window as unknown as BrowserWindow).__editorPerf)
    );
}

async function gesture(page: Page, kind: 'pan' | 'zoom', steps = 80): Promise<void> {
    await page.mouse.move(1380, 820);

    if (kind === 'zoom') {
        await page.keyboard.down('Control');
    } else {
        await page.mouse.down({ button: 'middle' });
    }

    try {
        for (let index = 0; index < steps; index += 1) {
            if (kind === 'pan') {
                const distance = index < steps / 2 ? index + 1 : steps - index;
                await page.mouse.move(1380 - distance * 12, 820 - distance * 2);
            } else {
                await page.mouse.wheel(0, index < steps / 2 ? -2 : 2);
            }
        }
    } finally {
        if (kind === 'zoom') {
            await page.keyboard.up('Control');
        } else {
            await page.mouse.up({ button: 'middle' });
        }
    }

    await page.waitForTimeout(300);
}

async function continuousGesture(
    page: Page,
    kind: 'pan' | 'zoom',
    steps = 80
): Promise<void> {
    await page.evaluate(
        async ({ kind, steps }) => {
            const canvas = document.querySelector('.schema-editor canvas')!;

            await new Promise<void>(done => {
                let index = 0;
                const tick = () => {
                    canvas.dispatchEvent(
                        new WheelEvent('wheel', {
                            bubbles: true,
                            cancelable: true,
                            clientX: 1380,
                            clientY: 820,
                            deltaX:
                                kind === 'pan'
                                    ? index < steps / 2
                                        ? 12
                                        : index === steps - 1
                                          ? 0
                                          : -12
                                    : 0,
                            deltaY:
                                kind === 'pan'
                                    ? index < steps / 2
                                        ? 2
                                        : index === steps - 1
                                          ? 0
                                          : -2
                                    : index < steps / 2
                                      ? -2
                                      : 2,
                            ctrlKey: kind === 'zoom',
                        })
                    );
                    index += 1;

                    if (index < steps) {
                        requestAnimationFrame(tick);
                    } else {
                        requestAnimationFrame(() => done());
                    }
                };
                requestAnimationFrame(tick);
            });
        },
        { kind, steps }
    );
    await page.waitForTimeout(300);
}

await mkdir(output, { recursive: true });
const server = await ensureEditorServer(baseUrl);
const browser = await chromium.launch({ headless: true, args: launchArgs });
const results: unknown[] = [];

try {
    if (browser.version() !== '139.0.7258.5') {
        throw new Error(`Expected Chromium 139.0.7258.5; received ${browser.version()}`);
    }

    for (const scene of scenes) {
        const context = await browser.newContext({
            viewport: { width: 1440, height: 900 },
            deviceScaleFactor: 2,
            reducedMotion: 'reduce',
        });
        await context.addInitScript('globalThis.__name = (value) => value;');
        await context.addInitScript(installProbe);
        const page = await context.newPage();
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(String(error)));
        const session = await context.newCDPSession(page);
        await session.send('Performance.enable');
        await page.goto(`${baseUrl}/?scene=${encodeURIComponent(scene)}`);
        await page.waitForFunction(
            () => {
                const value = (
                    window as unknown as BrowserWindow
                ).__editorPlayground?.read();

                return value?.ready && value.stats.renderedFrames > 0;
            },
            null,
            { timeout: 60000 }
        );
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(600);
        const initial = await state(page);

        if (
            initial.scene !== scene ||
            (scene === 'stress' &&
                (initial.loadedCards !== 2000 || initial.loadedConnections !== 4000))
        ) {
            throw new Error(`Unexpected workload: ${JSON.stringify(initial)}`);
        }
        const environment = await page.evaluate(() => {
            const canvas = document.querySelector(
                '.schema-editor canvas'
            ) as HTMLCanvasElement;
            const gl = canvas.getContext('webgl2');
            const extension = gl?.getExtension('WEBGL_debug_renderer_info');

            return {
                dpr: devicePixelRatio,
                viewport: { width: innerWidth, height: innerHeight },
                userAgent: navigator.userAgent,
                hardwareConcurrency: navigator.hardwareConcurrency,
                canvas: { width: canvas.width, height: canvas.height },
                graphics:
                    gl && extension
                        ? {
                              vendor: gl.getParameter(extension.UNMASKED_VENDOR_WEBGL),
                              renderer: gl.getParameter(
                                  extension.UNMASKED_RENDERER_WEBGL
                              ),
                              version: gl.getParameter(gl.VERSION),
                          }
                        : null,
            };
        });

        if (!environment.graphics) {
            throw new Error('Editor canvas has no WebGL2 context');
        }

        const memoryBefore = await session.send('Runtime.getHeapUsage');
        await reset(page);
        await page.waitForTimeout(1000);
        const idle = summarize(await sample(page));
        const phases = [];

        for (const source of [
            'trusted Playwright',
            'synthetic continuous DOM',
        ] as const) {
            for (const kind of ['pan', 'zoom'] as const) {
                await reset(page);
                const before = await state(page);

                if (source === 'trusted Playwright') {
                    await gesture(page, kind);
                } else {
                    await continuousGesture(page, kind);
                }

                const probe = await sample(page);
                const after = await state(page);

                if (
                    probe.frames.length < 20 ||
                    after.stats.renderedFrames - before.stats.renderedFrames < 20 ||
                    (kind === 'pan' &&
                        after.viewport.x === before.viewport.x &&
                        after.viewport.y === before.viewport.y)
                ) {
                    throw new Error(
                        `Insufficient rendered input samples for ${scene}/${kind}: ${probe.frames.length}`
                    );
                }

                phases.push({
                    source,
                    kind,
                    before,
                    after,
                    summary: summarize(probe),
                    raw: probe,
                });
                await writeFile(
                    resolve(output, `${scene}.partial.json`),
                    JSON.stringify(
                        {
                            complete: false,
                            scene,
                            environment,
                            initial,
                            idle,
                            phases,
                            memoryBefore,
                            errors,
                        },
                        null,
                        2
                    )
                );
                console.log(
                    `${scene}/${source}/${kind}: ${probe.frames.length} actual draw frames`
                );
            }
        }

        const memoryAfter = await session.send('Runtime.getHeapUsage');
        await session.send('Profiler.enable');
        await session.send('Profiler.setSamplingInterval', { interval: 1000 });
        await session.send('Profiler.start');
        await gesture(page, 'pan', 50);
        const { profile } = await session.send('Profiler.stop');
        const profileFile = resolve(output, `${scene}.cpuprofile`);
        await writeFile(profileFile, JSON.stringify(profile));
        const times = new Map<number, number>();
        profile.samples?.forEach((id, index) =>
            times.set(id, (times.get(id) ?? 0) + (profile.timeDeltas?.[index] ?? 0))
        );
        const topFunctions = profile.nodes
            .map(node => ({
                function: node.callFrame.functionName || '(anonymous)',
                url: node.callFrame.url,
                line: node.callFrame.lineNumber + 1,
                sampledMs: (times.get(node.id) ?? 0) / 1000,
            }))
            .sort((a, b) => b.sampledMs - a.sampledMs)
            .slice(0, 20);
        const result = {
            measuredAt: new Date().toISOString(),
            scene,
            environment,
            initial,
            idle,
            phases,
            memoryBefore,
            memoryAfter,
            profileFile,
            topFunctions,
            errors,
        };
        results.push(result);
        await writeFile(
            resolve(output, `${scene}.json`),
            JSON.stringify(result, null, 2)
        );
        await writeFile(
            resolve(output, `${scene}.partial.json`),
            JSON.stringify({ complete: true, resultFile: `${scene}.json` }, null, 2)
        );
        await page.screenshot({ path: resolve(output, `${scene}.png`) });
        console.log(
            JSON.stringify({
                scene,
                idle,
                phases: phases.map(phase => ({
                    source: phase.source,
                    kind: phase.kind,
                    summary: phase.summary,
                })),
                errors,
            })
        );

        if (errors.length > 0) {
            process.exitCode = 1;
        }

        await context.close();
    }
} finally {
    await writeFile(
        resolve(output, 'results.json'),
        JSON.stringify(
            {
                measuredAt: new Date().toISOString(),
                buildMode: 'webpack development',
                browser: browser.version(),
                node: process.version,
                os: {
                    platform: platform(),
                    release: release(),
                    cpu: cpus()[0]?.model,
                    logicalCpus: cpus().length,
                    totalMemoryBytes: totalmem(),
                },
                launchArgs,
                baseUrl,
                results,
                limitations: [
                    'SwiftShader is software rendering; hardware laptop 60 FPS remains unverified.',
                    'Frame intervals include only requestAnimationFrame callbacks issuing WebGL draw calls.',
                    'CPU submission ends before GPU completion. Input latency measures first queued input to CPU submission end.',
                    'Resource counters measure WebGL handles, not bytes or Pixi display objects. JS heap is measured without forced garbage collection.',
                    'Trusted Playwright cadence includes driver/compositor pacing; continuous DOM WheelEvents are synthetic throughput stimuli, not physical-device input.',
                    'The separate CPU profile adds overhead and is excluded from frame metrics.',
                ],
            },
            null,
            2
        )
    );
    await browser.close();
    await server.stop();
}
