export type CropRectangle = Readonly<{
    x: number;
    y: number;
    width: number;
    height: number;
}>;

export type ReferenceCrop = Readonly<{
    name: string;
    actual: CropRectangle;
    reference: CropRectangle;
}>;

export type ReferenceScreen = Readonly<{
    file: string;
    viewport: Readonly<{ width: number; height: number }>;
    crops: readonly ReferenceCrop[];
}>;

function crop(
    name: string,
    x: number,
    y: number,
    width: number,
    height: number
): ReferenceCrop {
    const bounds = { x, y, width, height };

    return { name, actual: bounds, reference: bounds };
}

export const references = {
    main: {
        file: '01-Main',
        viewport: { width: 1440, height: 900 },
        crops: [crop('editor', 0, 0, 1440, 900), crop('cards', 280, 80, 820, 640)],
    },
    variants: {
        file: '02-Variants',
        viewport: { width: 1200, height: 800 },
        crops: [
            crop('editor', 0, 0, 1200, 800),
            crop('payment', 72, 112, 396, 349),
            crop('bank', 552, 364, 236, 128),
        ],
    },
    'replace-preview': {
        file: '03-ReplacePreview',
        viewport: { width: 1200, height: 800 },
        crops: [crop('editor', 0, 0, 1200, 800), crop('dialog', 212, 16, 776, 768)],
    },
    'card-anatomy': {
        file: '05-CardAnatomy',
        viewport: { width: 1200, height: 900 },
        crops: [
            crop('editor', 0, 0, 1200, 900),
            crop('product', 56, 60, 428, 308),
            crop('states', 876, 88, 288, 508),
            crop('renaming', 56, 481, 378, 84),
            crop('reordering', 466, 481, 378, 114),
        ],
    },
    loading: {
        file: '06-States',
        viewport: { width: 1200, height: 900 },
        crops: [
            crop('editor', 0, 0, 1200, 900),
            crop('collection-states', 40, 155, 1120, 705),
        ],
    },
    'lod-overview': {
        file: '07-LOD',
        viewport: { width: 1560, height: 640 },
        crops: [crop('overview', 48, 96, 456, 460)],
    },
    'lod-working': {
        file: '07-LOD',
        viewport: { width: 1560, height: 640 },
        crops: [crop('working', 552, 96, 456, 460)],
    },
    'lod-detailed': {
        file: '07-LOD',
        viewport: { width: 1560, height: 640 },
        crops: [crop('detailed', 1052, 122, 428, 267)],
    },
    builder: {
        file: '11-Builder',
        viewport: { width: 1440, height: 900 },
        crops: [crop('editor', 0, 0, 1440, 900), crop('cards', 304, 104, 640, 230)],
    },
} as const satisfies Record<string, ReferenceScreen>;
