/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CacheProvider, createCacheRuntime } from '../../../../env/cache';
import { DependenciesContext } from '../../../di';
import type { Dependencies } from '../../../di';
import type { SchemaSummary } from '../../../../core/entities';
import { useRemoteEditorController } from '.';

const summary: SchemaSummary = {
    ref: 'schema:orders',
    id: 'orders',
    title: 'Orders',
    revision: 's2',
    updatedAt: '2025-10-20T12:00:00Z',
    documentCount: 1,
};
let root: ReturnType<typeof createRoot> | undefined;
let controller: ReturnType<typeof useRemoteEditorController>;
let location: string;
const runtime = createCacheRuntime();

afterEach(async () => {
    await act(async () => root?.unmount());
    runtime.invalidator.clearAll();
    vi.unstubAllGlobals();
});

function Harness() {
    controller = useRemoteEditorController();
    location = useLocation().search;

    return null;
}

async function mount(url: string) {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const refreshed = vi.fn(async () => summary);
    const dependencies: Dependencies = {
        mode: 'api',
        apiBaseUrl: '',
        createId: () => 'attempt',
        loadEditor: vi.fn(),
        listSchemas: {
            name: 'schemas',
            reads: () => [
                'schema',
            ],
            execute: async () => [
                summary,
            ],
        },
        getSchema: {
            name: 'schema',
            reads: () => [
                'schema:orders',
            ],
            execute: async () => summary,
        },
        getAnalysis: {
            name: 'analysis',
            reads: () => [],
            execute: vi.fn(),
        },
        createAnalysis: {
            execute: vi.fn(),
            writes: () => [],
        },
        recordSchemaSaved: {
            execute: refreshed,
            writes: () => [
                'schema',
                'schema:orders',
            ],
        },
    };
    root = createRoot(document.createElement('div'));
    await act(async () =>
        root?.render(
            <CacheProvider runtime={runtime}>
                <DependenciesContext.Provider value={dependencies}>
                    <MemoryRouter
                        initialEntries={[
                            url,
                        ]}
                    >
                        <Harness />
                    </MemoryRouter>
                </DependenciesContext.Provider>
            </CacheProvider>
        )
    );

    return refreshed;
}

describe('editor resource routing', () => {
    it('refreshes save metadata without changing a pinned resource and resetting its editing session', async () => {
        const refreshed = await mount('/edit?schemaId=orders&revision=s1');
        await act(async () =>
            controller.onSaved({
                schemaId: 'orders',
                revision: 's2',
            })
        );

        expect(location).toBe('?schemaId=orders&revision=s1');
        expect(controller.resource).toEqual({
            kind: 'schema',
            schemaId: 'orders',
            revision: 's1',
        });
        expect(refreshed).toHaveBeenCalledWith({
            schemaId: 'orders',
            revision: 's2',
        });
    });
});
