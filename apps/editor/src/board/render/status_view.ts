import type { BoardModel } from '../model/types';
import { RetainedLabel, type LabelMetrics } from '../text/labels';

const messages = {
    loading: 'Loading schema...',
    empty: 'No schema fields are loaded',
    failed: 'Schema could not load',
} as const;

export class BoardStatusView {
    private readonly label: RetainedLabel;
    private destroyed = false;

    constructor(
        private readonly metrics: LabelMetrics,
        resolution: number
    ) {
        this.label = new RetainedLabel(metrics, resolution);
        this.label.view.visible = false;
    }

    get view() {
        return this.label.view;
    }

    update(
        state: BoardModel['state'],
        cardCount: number,
        width: number,
        height: number
    ): void {
        if (this.destroyed) {
            return;
        }

        this.view.visible = cardCount === 0 && state !== 'ready';

        if (!this.view.visible || state === 'ready') {
            return;
        }

        const text = messages[state];
        this.label.update({
            text,
            x: Math.max(24, (width - this.metrics.width(text, 'body')) / 2),
            y: height / 2,
            role: 'body',
            ink: state === 'failed' ? 'danger' : 'label-secondary',
            maxWidth: Math.max(0, width - 48),
        });
    }

    destroy(): void {
        if (this.destroyed) {
            return;
        }

        this.destroyed = true;
        this.view.removeFromParent();
        this.view.destroy();
    }
}
