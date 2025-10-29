import { describe, expect, it } from 'vitest';
import { readDocument } from '.';

describe('source document upload', () => {
    it('describes the transmitted UTF-8 content after a file BOM is removed', async () => {
        const file = new File(
            [
                new Uint8Array([
                    239,
                    187,
                    191,
                ]),
                '<price>€</price>',
            ],
            'price.xml'
        );

        expect(await readDocument(file)).toEqual({
            name: 'price.xml',
            format: 'xml',
            content: '<price>€</price>',
            size: 18,
        });
    });

    it('rejects a file above the server limit before submission', async () => {
        const file = new File(
            [
                'x'.repeat(5_000_001),
            ],
            'large.json'
        );

        await expect(readDocument(file).then(() => undefined)).rejects.toThrow('5 MB');
    });
});
