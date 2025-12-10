/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CacheProvider, createCacheRuntime } from '../../../../env/cache';
import { DependenciesContext } from '../../../di';
import type { Dependencies } from '../../../di';
import type { SchemaSummary } from '../../../../core/entities';
import { useWorkspaceController } from '.';

const schema: SchemaSummary = {
    ref: 'schema:orders',
    id: 'orders',
    title: 'Orders',
    revision: 's2',
    updatedAt: '2025-10-20T12:00:00Z',
    documentCount: 1,
};
let root: ReturnType<typeof createRoot> | undefined;
let controller: ReturnType<typeof useWorkspaceController>;
const runtime = createCacheRuntime();

afterEach(async () => {
    await act(async () => root?.unmount());
    runtime.invalidator.clearAll();
    vi.unstubAllGlobals();
});

function Harness() {
    controller = useWorkspaceController();

    return null;
}

async function mount() {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const calls = {
        navigate: vi.fn(),
        endSession: vi.fn(async () => ({
            endSessionUrl: 'https://idp.test/logout',
        })),
        deleteSchema: vi.fn(async () => undefined),
    };
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
                schema,
            ],
        },
        getSchema: {
            name: 'schema',
            reads: () => [],
            execute: vi.fn(),
        },
        getAnalysis: {
            name: 'analysis',
            reads: () => [],
            execute: vi.fn(),
        },
        listAnalyses: {
            name: 'analyses',
            reads: () => [
                'analysis',
            ],
            execute: async () => [],
        },
        getSession: {
            name: 'session',
            reads: () => [
                'session:current',
            ],
            execute: async () => ({
                ref: 'session:current',
                sub: 'user-1',
                roles: [],
            }),
        },
        createAnalysis: {
            execute: vi.fn(),
            writes: () => [],
        },
        deleteAnalysis: {
            execute: vi.fn(),
            writes: () => [],
        },
        deleteSchema: {
            execute: calls.deleteSchema,
            writes: () => [
                'schema',
            ],
        },
        endSession: {
            execute: calls.endSession,
            writes: () => [],
        },
        recordSchemaSaved: {
            execute: vi.fn(),
            writes: () => [],
        },
        navigate: calls.navigate,
        redirectToLogin: vi.fn(),
    };
    root = createRoot(document.createElement('div'));
    await act(async () =>
        root?.render(
            <CacheProvider runtime={runtime}>
                <DependenciesContext.Provider value={dependencies}>
                    <MemoryRouter>
                        <Harness />
                    </MemoryRouter>
                </DependenciesContext.Provider>
            </CacheProvider>
        )
    );
    await act(async () => new Promise(resolve => setTimeout(resolve, 50)));

    return calls;
}

describe('workspace session and deletion', () => {
    it('shows the current user and navigates to the end session url after logout', async () => {
        const calls = await mount();

        expect(controller.user?.sub).toBe('user-1');
        await act(async () => controller.logout());
        expect(calls.endSession).toHaveBeenCalledTimes(1);
        expect(calls.navigate).toHaveBeenCalledWith('https://idp.test/logout');
    });

    it('deletes a schema only after confirmation, with the known revision', async () => {
        const calls = await mount();

        await act(async () =>
            controller.requestDeletion({
                kind: 'schema',
                id: 'orders',
            })
        );
        expect(calls.deleteSchema).not.toHaveBeenCalled();
        await act(async () => controller.confirmDeletion());
        expect(calls.deleteSchema).toHaveBeenCalledWith({
            schemaId: 'orders',
            revision: 's2',
        });
        expect(controller.pendingDeletion).toBeNull();
    });
});
