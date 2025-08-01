import { Container, Graphics } from 'pixi.js';
import { RetainedLabel, type LabelMetrics, type LabelSpec } from '../../text';
import { paint as themePaint, type ColorName } from '../../theme';

export class LabelGroup {
    readonly root = new Container();
    readonly graphics = new Graphics();
    private readonly labels = new Map<string, RetainedLabel>();
    private readonly used = new Set<string>();

    constructor(
        protected readonly metrics: LabelMetrics,
        protected resolution: number
    ) {
        this.root.addChild(this.graphics);
    }

    protected paint(name: ColorName) {
        return themePaint(name, this.metrics.theme);
    }

    begin(): void {
        this.used.clear();
        this.graphics.clear();
    }

    label(key: string, spec: LabelSpec): void {
        let label = this.labels.get(key);

        if (!label) {
            label = new RetainedLabel(this.metrics, this.resolution);
            this.labels.set(key, label);
            this.root.addChild(label.view);
        }

        this.used.add(key);
        label.update(spec);
    }

    end(): void {
        for (const [key, label] of this.labels) {
            if (!this.used.has(key)) {
                this.root.removeChild(label.view);
                label.view.destroy();
                this.labels.delete(key);
            }
        }
    }

    setResolution(resolution: number): void {
        this.resolution = resolution;

        for (const label of this.labels.values()) {
            label.view.resolution = resolution;
        }
    }

    get textCount(): number {
        return this.labels.size;
    }

    destroy(): void {
        this.root.destroy({ children: true });
        this.labels.clear();
    }
}
