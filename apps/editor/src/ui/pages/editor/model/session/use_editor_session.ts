import { useEffect, useRef, useState } from 'react';
import type { PlaygroundScene } from '../../../../../../playground';
import { EditorDocument } from '../../../../../app/editor/document';
import type { SchemaDocument } from '../../../../../core/entities/schema';
import type { EditorDependenciesFactory } from '../../../../di';
import { fixtureDocument } from '../../lib/fixture';
import { errorText } from '../../lib/errors';
import { initialView } from '../../lib/projection';
import type { EditorProps } from '../resource';
import { emptyModel, integrate, type Session } from './session';

export function useEditorSession(
    props: EditorProps,
    scene: PlaygroundScene,
    createDependencies: EditorDependenciesFactory
) {
    const demo = props.apiBaseUrl === 'fixture://standalone';
    const resource = props.resource;
    const resourceKey = JSON.stringify([
        props.apiBaseUrl,
        resource.kind,
        resource.kind === 'schema'
            ? [
                  resource.schemaId,
                  resource.revision ?? null,
              ]
            : [
                  resource.analysisId,
                  resource.revision,
                  resource.rootAlternativeId ?? null,
              ],
        demo ? scene.id : null,
    ]);
    const [session, setSession] = useState<Session | null>(null);
    const sessionRef = useRef<Session | null>(null);
    const epoch = useRef(0);
    const announcedDrafts = useRef(new Set<string>());
    const draftKeys = useRef(new Map<string, string>());
    const drafts = useRef(new Map<string, Promise<SchemaDocument>>());
    const reads = useRef(new Map<string, AbortController>());
    const [version, setVersion] = useState(0);
    const [retry, setRetry] = useState(0);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [saveBlocked, setSaveBlocked] = useState(false);
    const callbacks = useRef(props);
    callbacks.current = props;

    function refresh(): void {
        setVersion(value => value + 1);
    }

    useEffect(() => {
        const generation = ++epoch.current;
        reads.current.forEach(controller => controller.abort());
        reads.current.clear();
        sessionRef.current = null;
        setSession(null);
        setBusy(false);
        setSaveBlocked(false);
        setMessage(null);
        setError(null);
        const controller = new AbortController();
        reads.current.set('open', controller);
        const seed = demo
            ? fixtureDocument(
                  scene.board,
                  {
                      resource: 'schema',
                      id:
                          props.resource.kind === 'schema'
                              ? props.resource.schemaId
                              : `demo-${props.resource.analysisId}`,
                      revision:
                          props.resource.kind === 'schema'
                              ? (props.resource.revision ?? 'fixture-1')
                              : 'fixture-1',
                  },
                  scene.title
              )
            : null;
        const dependencies = createDependencies(seed?.fixture ?? null);

        if (seed) {
            const next: Session = {
                identity: resourceKey,
                document: seed.document,
                dependencies,
                view: initialView(scene.board),
                template: scene.board,
            };
            sessionRef.current = next;
            setSession(next);
        } else {
            void (async () => {
                let manifest: SchemaDocument;

                if (props.resource.kind === 'schema') {
                    manifest = await dependencies.openSchema.execute(props.resource, {
                        signal: controller.signal,
                    });
                } else {
                    let pending = drafts.current.get(resourceKey);

                    if (!pending) {
                        const idempotencyKey =
                            draftKeys.current.get(resourceKey) ?? crypto.randomUUID();
                        draftKeys.current.set(resourceKey, idempotencyKey);
                        pending = dependencies.createDraft.execute({
                            ...props.resource,
                            idempotencyKey,
                        });
                        drafts.current.set(resourceKey, pending);
                        void pending.catch(() => drafts.current.delete(resourceKey));
                    }

                    manifest = await pending;
                }

                if (epoch.current !== generation || controller.signal.aborted) {
                    return;
                }

                if (
                    props.resource.kind === 'analysis' &&
                    !announcedDrafts.current.has(resourceKey)
                ) {
                    announcedDrafts.current.add(resourceKey);
                    callbacks.current.onCreated?.({
                        schemaId: manifest.snapshot.id,
                        revision: manifest.snapshot.revision,
                    });
                }

                const document = new EditorDocument(manifest);
                const branch = await dependencies.loadBranch.execute(
                    {
                        snapshot: manifest.snapshot,
                        nodeId: manifest.rootNodeId,
                    },
                    {
                        signal: controller.signal,
                    }
                );

                if (epoch.current !== generation || controller.signal.aborted) {
                    return;
                }

                const next: Session = {
                    identity: resourceKey,
                    document,
                    dependencies,
                    view: initialView(emptyModel),
                    template: emptyModel,
                };
                integrate(next, branch);
                sessionRef.current = next;
                setSession(next);
            })().catch((reason: unknown) => {
                if (epoch.current === generation && !controller.signal.aborted) {
                    setError(errorText(reason));
                }
            });
        }

        return () => {
            epoch.current += 1;
            reads.current.forEach(read => read.abort());
            reads.current.clear();
            dependencies.cleanup();
        };
    }, [
        resourceKey,
        retry,
        scene,
        createDependencies,
    ]);

    const activeSession = session?.identity === resourceKey ? session : null;

    return {
        activeSession,
        sessionRef,
        epoch,
        drafts,
        reads,
        version,
        retry,
        demo,
        resourceKey,
        message,
        error,
        busy,
        saveBlocked,
        callbacks,
        setRetry,
        setMessage,
        setBusy,
        setSaveBlocked,
        refresh,
    };
}

export type EditorSessionState = ReturnType<typeof useEditorSession>;
