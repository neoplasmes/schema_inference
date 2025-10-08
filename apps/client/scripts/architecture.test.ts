import { describe, expect, it } from 'vitest';
import { inspectModules } from '../../editor/scripts/architecture';

describe('client architecture boundaries', () => {
    it('rejects technology imports from application operations', () => {
        const violations = inspectModules([
            {
                name: 'app/queries/index.ts',
                text: 'export {};',
            },
            {
                name: 'app/queries/bad.ts',
                text: "import { useQuery } from '@tanstack/react-query'; import { EntityStore } from '@app/entity-cache/store'; import { createStore } from 'zustand/vanilla'; export const value = [useQuery, EntityStore, createStore];",
            },
        ]);
        expect(violations.map(value => value.rule)).toEqual(
            expect.arrayContaining([
                'cache-framework-boundary',
                'store-framework-boundary',
            ])
        );
    });

    it('rejects concrete repositories in UI while allowing its cache facade', () => {
        const violations = inspectModules([
            {
                name: 'ui/index.ts',
                text: "export { value } from './screen';",
            },
            {
                name: 'ui/screen.ts',
                text: "import { repo } from '../env/repos'; import { cache } from '../env/cache'; export const value = [repo, cache];",
            },
            {
                name: 'env/repos/index.ts',
                text: 'export const repo = 1;',
            },
            {
                name: 'env/cache/index.ts',
                text: 'export const cache = 1;',
            },
        ]);
        expect(
            violations.some(value => value.rule === 'concrete-repository-boundary')
        ).toBe(true);
        expect(violations.some(value => value.detail.includes('env/cache'))).toBe(false);
    });
});
