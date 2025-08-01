import { Application, Container, Sprite, type Texture } from 'pixi.js';
import type { BoardRendererOptions } from '../contracts';
import { LabelMetrics } from '../../text';
import { resolveTheme } from '../../theme';
import { createBackground, createShadow } from '../background';
import { BoardStatusView } from '../status';

export type SceneResources = {
    world: Container;
    metrics: LabelMetrics;
    shadow: Texture;
    status: BoardStatusView;
};

export class SceneLifecycle {
    readonly theme;
    readonly resolution: number;
    width: number;
    height: number;
    private readonly app = new Application();
    private readonly world = new Container();
    private initialized = false;
    private applicationInitialized = false;
    private applicationDestroyed = false;
    private destroyed = false;
    private frame: number | null = null;
    private background: Sprite | null = null;
    private resources: SceneResources | null = null;

    constructor(private readonly options: BoardRendererOptions) {
        this.theme = resolveTheme(options.theme);
        this.width = Math.max(1, options.width ?? options.container.clientWidth);
        this.height = Math.max(1, options.height ?? options.container.clientHeight);
        this.resolution = Math.min(
            2,
            Math.max(1, options.resolution ?? window.devicePixelRatio ?? 1)
        );
    }

    async initialize(mounted: (resources: SceneResources) => void): Promise<void> {
        await this.app.init({
            width: this.width,
            height: this.height,
            antialias: true,
            resolution: this.resolution,
            autoDensity: true,
            autoStart: false,
            sharedTicker: false,
            preference: 'webgl',
            backgroundAlpha: 0,
        });
        this.applicationInitialized = true;

        if (this.destroyed) {
            this.destroyApplication();

            return;
        }

        await document.fonts?.ready;

        if (this.destroyed) {
            this.destroyApplication();

            return;
        }

        this.initialized = true;
        this.app.canvas.style.display = 'block';
        this.app.canvas.style.width = '100%';
        this.app.canvas.style.height = '100%';
        this.options.container.appendChild(this.app.canvas);
        this.app.stage.eventMode = 'none';
        this.app.stage.addChild(this.world);
        const metrics = new LabelMetrics(this.theme);
        const status = new BoardStatusView(metrics, this.resolution);
        this.app.stage.addChild(status.view);
        this.resources = {
            world: this.world,
            metrics,
            status,
            shadow: createShadow(this.theme),
        };
        this.app.renderer.resize(this.width, this.height);
        this.replaceBackground();
        mounted(this.resources);
    }

    schedule(render: () => void): void {
        if (this.destroyed || !this.initialized || this.frame !== null) {
            return;
        }

        this.frame = requestAnimationFrame(() => {
            this.frame = null;
            render();
        });
    }

    render(): void {
        this.app.render();
    }

    resize(width: number, height: number): boolean {
        const w = Math.max(1, width);
        const h = Math.max(1, height);

        if (this.destroyed || (this.width === w && this.height === h)) {
            return false;
        }

        this.width = w;
        this.height = h;

        if (this.initialized) {
            this.app.renderer.resize(this.width, this.height);
            this.replaceBackground();
        }

        return true;
    }

    private replaceBackground(): void {
        if (!this.initialized || this.options.background === false) {
            return;
        }

        const texture = createBackground(
            this.width,
            this.height,
            this.resolution,
            this.theme
        );

        if (this.background) {
            const previous = this.background.texture;
            this.background.texture = texture;
            previous.destroy(true);
        } else {
            this.background = new Sprite(texture);
            this.app.stage.addChildAt(this.background, 0);
        }

        this.background.width = this.width;
        this.background.height = this.height;
    }

    private destroyApplication(): void {
        if (this.applicationInitialized && !this.applicationDestroyed) {
            this.applicationDestroyed = true;
            this.app.destroy(true, { children: true });
        }
    }

    destroy(): void {
        if (this.destroyed) {
            return;
        }

        this.destroyed = true;

        if (this.frame !== null) {
            cancelAnimationFrame(this.frame);
            this.frame = null;
        }

        const backgroundTexture = this.background?.texture;
        this.resources?.status.destroy();
        this.destroyApplication();
        backgroundTexture?.destroy(true);
        this.resources?.shadow.destroy(true);
        this.resources?.metrics.clear();
        this.resources = null;
    }
}
