import { Texture } from 'pixi.js';
import { themeRadius, type ResolvedBoardTheme } from './theme';
import { cssAlpha } from './colors';
import { grainPixels } from './grain';

/** Stable grain keeps screenshots deterministic and remains fixed in screen space. */
export function createBackground(
    width: number,
    height: number,
    resolution: number,
    theme: ResolvedBoardTheme
): Texture {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(width * resolution));
    canvas.height = Math.max(1, Math.ceil(height * resolution));
    const context = canvas.getContext('2d');

    if (!context) {
        throw new Error('Canvas background could not initialize');
    }

    context.scale(resolution, resolution);
    context.fillStyle = theme.color['surface-canvas'];
    context.fillRect(0, 0, width, height);

    const gradient = (
        x: number,
        y: number,
        radiusX: number,
        radiusY: number,
        stop: number,
        ink: 'canvas-glow' | 'canvas-shade' | 'canvas-tint',
        alpha: number
    ) => {
        context.save();
        context.translate(x, y);
        context.scale(radiusX, radiusY);
        const fill = context.createRadialGradient(0, 0, 0, 0, 0, 1);
        fill.addColorStop(0, cssAlpha(ink, alpha, theme));
        fill.addColorStop(stop, cssAlpha(ink, 0, theme));
        fill.addColorStop(1, cssAlpha(ink, 0, theme));
        context.fillStyle = fill;
        context.fillRect(-x / radiusX, -y / radiusY, width / radiusX, height / radiusY);
        context.restore();
    };

    gradient(
        width * 0.95,
        height * 0.15,
        width * 0.6,
        height * 0.8,
        0.7,
        'canvas-shade',
        1
    );
    gradient(width, height, width * 0.55, height * 0.7, 0.7, 'canvas-tint', 0.06);
    gradient(width * 0.12, 0, width * 0.7, height * 0.9, 0.65, 'canvas-glow', 1);

    const grain = document.createElement('canvas');
    const grainSize = Math.max(128, Math.ceil(128 * resolution));
    grain.width = grain.height = grainSize;
    const grainContext = grain.getContext('2d');

    if (grainContext) {
        const data = grainContext.createImageData(grainSize, grainSize);
        data.data.set(grainPixels(grainSize));
        grainContext.putImageData(data, 0, 0);
        context.save();
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.globalAlpha = 1;
        context.globalCompositeOperation = 'source-over';
        context.fillStyle = context.createPattern(grain, 'repeat')!;
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.restore();
    }

    return Texture.from(canvas);
}

export function createShadow(theme: ResolvedBoardTheme): Texture {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const context = canvas.getContext('2d');

    if (!context) {
        throw new Error('Card shadow could not initialize');
    }

    const layers = [
        ...theme.shadow['shadow-card'].matchAll(
            /0 (\d+)px (\d+)px rgba\(0,0,0,([.\d]+)\)/g
        ),
    ];

    for (const layer of layers) {
        context.save();
        context.shadowColor = cssAlpha('label', Number(layer[3]), theme);
        context.shadowOffsetY = Number(layer[1]);
        context.shadowBlur = Number(layer[2]);
        context.fillStyle = theme.color['surface-card'];
        context.beginPath();
        context.roundRect(16, 16, 32, 32, themeRadius(theme, 'radius-md'));
        context.fill();
        context.restore();
    }

    return Texture.from(canvas);
}
