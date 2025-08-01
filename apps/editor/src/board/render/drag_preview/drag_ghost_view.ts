import { Container, Graphics, NineSliceSprite, type Texture } from 'pixi.js';
import type { BoardRow, Point } from '../../model';
import type { Rectangle } from '../contracts';
import { RetainedLabel, type LabelMetrics } from '../../text';
import { paint } from '../../theme';
import { themeRadius } from '../../theme';

export class DragGhostView {
    readonly root = new Container();
    private readonly shadow: NineSliceSprite;
    private readonly surface = new Graphics();
    private readonly name: RetainedLabel;
    private readonly type: RetainedLabel;

    constructor(
        private readonly metrics: LabelMetrics,
        shadow: Texture,
        resolution: number
    ) {
        this.shadow = new NineSliceSprite({
            texture: shadow,
            leftWidth: 28,
            rightWidth: 28,
            topHeight: 28,
            bottomHeight: 28,
        });
        this.name = new RetainedLabel(metrics, resolution);
        this.type = new RetainedLabel(metrics, resolution);
        this.root.eventMode = 'none';
        this.root.addChild(this.shadow, this.surface, this.name.view, this.type.view);
    }

    update(row: BoardRow, bounds: Rectangle, pointer: Point, resolution: number): void {
        const width = Math.min(220, bounds.width);
        const height = bounds.height;
        const center = height / 2;
        this.root.visible = true;
        this.root.position.set(pointer.x - width / 2, pointer.y - height / 2);
        this.shadow.position.set(-16, -16);
        this.shadow.width = width + 32;
        this.shadow.height = height + 32;
        this.surface
            .clear()
            .roundRect(0, 0, width, height, themeRadius(this.metrics.theme, 'radius-md'))
            .fill(paint('surface-card', this.metrics.theme));

        for (const offset of [-4, 0, 4]) {
            this.surface
                .circle(18, center + offset, 0.8)
                .fill(paint('label-tertiary', this.metrics.theme));
        }

        const typeWidth = Math.min(
            width * 0.48,
            this.metrics.width(row.typeLabel, 'mono')
        );
        this.name.view.resolution = resolution;
        this.type.view.resolution = resolution;
        this.name.update({
            text: row.name,
            x: 34,
            y: center,
            bold: true,
            maxWidth: Math.max(0, width - 34 - 14 - typeWidth - 12),
        });
        this.type.update({
            text: row.typeLabel,
            x: width - 14,
            y: center,
            role: 'mono',
            ink: 'label-secondary',
            right: true,
            maxWidth: typeWidth,
        });
    }
}
