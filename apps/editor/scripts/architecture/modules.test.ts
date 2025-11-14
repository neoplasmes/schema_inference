import { describe, expect, it } from 'vitest';
import { inspectModules, type SourceModule } from '.';

function check(entries: Record<string, string>) {
    const modules: SourceModule[] = Object.entries(entries).map(([name, text]) => ({
        name,
        text,
    }));

    return inspectModules(modules);
}

describe('source architecture', () => {
    it.each([
        'core',
        'env',
        'shared',
        'app',
        'main',
    ])('forbids an index at the %s layer root', layer => {
        expect(
            check({
                [`${layer}/index.ts`]: 'export {};',
            })
        ).toEqual([
            {
                file: `${layer}/index.ts`,
                rule: 'layer-entry',
                detail: 'Architecture layers must not expose index.ts.',
            },
        ]);
    });

    it('requires package entries without requiring entries at layer roots', () => {
        expect(
            check({
                'core/entities/index.ts': 'export type Entity = string;',
                'env/transport/index.ts': 'export class Transport {}',
                'shared/lib/index.ts':
                    'export const identity = (value: unknown) => value;',
                'app/commands/index.ts': 'export class Command {}',
                'main/editor/index.ts': 'export function createEditor() {}',
            })
        ).toEqual([]);
    });

    it.each([
        '../main',
        '../main/index',
        '../main/index.ts',
    ])('rejects importing a whole layer through %s', specifier => {
        expect(
            check({
                'expose/index.ts': `export { Editor } from '${specifier}';`,
            }).map(item => item.rule)
        ).toEqual([
            'layer-import',
        ]);
    });

    it('requires a public entry for every nested package', () => {
        const violations = check({
            'board/render/card/card.ts': 'export class Card {}',
        });

        expect(
            violations.filter(item => item.rule === 'public-entry').map(item => item.file)
        ).toEqual([
            'board/render/card/index.ts',
            'board/render/index.ts',
            'board/index.ts',
        ]);
    });

    it('rejects UI imports of repositories even through a public entry', () => {
        const violations = check({
            'ui/index.ts':
                "import { Repository } from '../env/repos'; export { Repository };",
            'env/repos/index.ts': 'export class Repository {}',
        });

        expect(violations.some(item => item.rule === 'layer-direction')).toBe(true);
    });

    it('rejects cross-package implementation imports', () => {
        const violations = check({
            'board/index.ts': "export { Card } from './render/card';",
            'board/render/index.ts': "export { Card } from './card';",
            'board/render/card.ts': 'export class Card {}',
        });

        expect(violations.filter(item => item.rule === 'public-import')).toHaveLength(1);
    });

    it('rejects Pixi or browser dependencies in business logic', () => {
        const violations = check({
            'app/commands/index.ts':
                "import type { Container } from 'pixi.js'; export const canvas = document.createElement('canvas');",
        });

        expect(violations.map(item => item.rule)).toEqual([
            'pixi-boundary',
            'browser-boundary',
        ]);
    });

    it('permits local variables named window without permitting the browser global', () => {
        expect(
            check({
                'app/commands/index.ts':
                    'export function count(window: { size: number }) { return window.size; }',
            })
        ).toEqual([]);
        expect(
            check({
                'app/commands/index.ts': 'export const width = window.innerWidth;',
            }).some(item => item.rule === 'browser-boundary')
        ).toBe(true);
    });

    it('keeps generic transport and cache away from repositories', () => {
        const violations = check({
            'env/transport/index.ts':
                "import { Model } from '../../core/entities'; export { Model };",
            'env/cache/index.ts':
                "import { Repository } from '../repos'; export { Repository };",
            'env/repos/index.ts': 'export class Repository {}',
            'core/entities/index.ts': 'export type Model = string;',
        });

        expect(violations.map(item => item.rule)).toEqual([
            'transport-boundary',
            'cache-boundary',
        ]);
    });

    it('finds runtime cycles through public entries but allows type-only cycles', () => {
        const entries = {
            'board/index.ts': "export { Card } from './card';",
            'board/card/index.ts': "import { Card } from '..'; export { Card };",
        };

        expect(check(entries).some(item => item.rule === 'runtime-cycle')).toBe(true);
        expect(
            check({
                ...entries,
                'board/card/index.ts':
                    "import type { Card } from '..'; export type { Card };",
            })
        ).toEqual([]);
    });
});
