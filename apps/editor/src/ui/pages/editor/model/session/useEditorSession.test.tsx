/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorDependencies } from '../../../../di';
import type { SchemaDocument } from '../../../../../core/entities/schema';
import type { EditorProps } from '../resource';
import { getScene } from '../../../../../../playground';
import { useEditorSession } from '.';

const manifest: SchemaDocument = {
    snapshot: {
        resource: 'schema',
        id: 'created',
        revision: 's1',
    },
    title: 'Created',
    rootNodeId: 'root',
    profile: {
        syntax: 'xml',
        dialect: 'xsd-1.0',
    },
};
const scene = getScene('builder');
let root: ReturnType<typeof createRoot>;
let state: ReturnType<typeof useEditorSession>;

beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    root = createRoot(document.createElement('div'));
});

afterEach(async () => {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
});

function dependencies(create = async () => manifest): EditorDependencies {
    return {
        createDraft: {
            execute: create,
        },
        openSchema: {
            execute: async () => manifest,
        },
        loadBranch: {
            execute: async () => ({
                rootNodeId: 'root',
                title: 'Root',
                nodes: [],
                pages: [],
            }),
        },
        readNode: {
            execute: vi.fn(),
        },
        readMembers: {
            execute: vi.fn(),
        },
        saveSchema: {
            execute: vi.fn(),
        },
        readChange: {
            execute: vi.fn(),
        },
        cleanup: vi.fn(),
    };
}

function Harness({
    props,
    factory,
}: {
    props: EditorProps;
    factory: () => EditorDependencies;
}) {
    state = useEditorSession(props, scene, factory);

    return null;
}

describe('created schema notification', () => {
    it('emits the accepted draft identity once even if loading is retried', async () => {
        const onCreated = vi.fn();
        const factory = () => dependencies();
        await act(async () =>
            root.render(
                <Harness
                    props={{
                        resource: {
                            kind: 'analysis',
                            analysisId: 'a1',
                            revision: 'a1',
                        },
                        apiBaseUrl: '',
                        onCreated,
                    }}
                    factory={factory}
                />
            )
        );

        expect(onCreated).toHaveBeenCalledExactlyOnceWith({
            schemaId: 'created',
            revision: 's1',
        });
        await act(async () => state.setRetry(value => value + 1));
        expect(onCreated).toHaveBeenCalledTimes(1);
    });

    it('does not announce creation when opening a saved schema', async () => {
        const onCreated = vi.fn();
        await act(async () =>
            root.render(
                <Harness
                    props={{
                        resource: {
                            kind: 'schema',
                            schemaId: 'created',
                        },
                        apiBaseUrl: '',
                        onCreated,
                    }}
                    factory={() => dependencies()}
                />
            )
        );

        expect(onCreated).not.toHaveBeenCalled();
    });

    it('ignores a draft response after the editor has unmounted', async () => {
        let resolve!: (document: SchemaDocument) => void;
        const pending = new Promise<SchemaDocument>(accept => {
            resolve = accept;
        });
        const onCreated = vi.fn();
        await act(async () =>
            root.render(
                <Harness
                    props={{
                        resource: {
                            kind: 'analysis',
                            analysisId: 'a1',
                            revision: 'a1',
                        },
                        apiBaseUrl: '',
                        onCreated,
                    }}
                    factory={() => dependencies(() => pending)}
                />
            )
        );
        await act(async () => root.unmount());
        await act(async () => resolve(manifest));

        expect(onCreated).not.toHaveBeenCalled();
    });
});
