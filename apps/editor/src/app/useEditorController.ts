import { useEffect, useMemo, useRef, useState } from 'react';
import type { PlaygroundScene } from '../../playground/scenes';
import { SchemaWriteRejectedError } from '../application/ports/repos/schema.repo.error';
import { EditorDocument } from '../application/editor/editor_document';
import { CreateDraftCommand, SaveSchemaCommand } from '../application/commands/index';
import type {
    ChangeReceipt,
    SchemaRepository,
} from '../application/ports/repos/schema.repo';
import {
    LoadBranchQuery,
    type LoadedBranch,
} from '../application/queries/load_branch/load_branch.query';
import {
    OpenSchemaQuery,
    ReadSchemaChangeQuery,
    ReadSchemaMembersQuery,
    ReadSchemaNodeQuery,
} from '../application/queries/index';
import type { BoardEventMap, BoardModel, BoardSelection } from '../board';
import type { SchemaDocument, SchemaMember } from '../core/schema';
import type { EditorProps } from '../expose/Editor';
import { fixtureDocument } from './fixture';
import { observedPreview, projectEvidence } from './evidencePreview';
import {
    branchView,
    initialView,
    memberInDocument,
    projectDocument,
    type EditorView,
} from './projection';
import type { BoardHandlers } from './useSchemaBoard';
import type { EditorDependenciesFactory } from './dependencies';

const emptyModel: BoardModel = {
    version: 0,
    cards: [],
    connections: [],
    selection: null,
    state: 'loading',
};
type Session = {
    identity: string;
    document: EditorDocument;
    repository: SchemaRepository;
    view: EditorView;
    template: BoardModel;
};

function expandedMembers(session: Session): ReadonlySet<string> {
    return new Set(
        session.view.connections
            .filter(
                connection =>
                    session.view.expanded.get(
                        `${connection.sourceBlockId}/${connection.sourceMemberId}`
                    ) !== false
            )
            .map(connection => connection.sourceMemberId)
    );
}

export function useEditorController(
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
            ? [resource.schemaId, resource.revision ?? null]
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

    function integrate(target: Session, branch: LoadedBranch, blockId?: string): void {
        branch.nodes.forEach(node => target.document.nodes.set(node.id, node));
        branch.pages.forEach(page =>
            target.document.addPage(page, 'replace', expandedMembers(target))
        );
        const view = branchView(branch, blockId);
        target.view.branches.set(view.blockId, view);
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
        const repository = dependencies.repository;

        if (seed) {
            const next: Session = {
                identity: resourceKey,
                document: seed.document,
                repository,
                view: initialView(scene.board),
                template: scene.board,
            };
            sessionRef.current = next;
            setSession(next);
        } else {
            void (async () => {
                let manifest: SchemaDocument;

                if (props.resource.kind === 'schema') {
                    manifest = await new OpenSchemaQuery(repository).execute(
                        props.resource,
                        { signal: controller.signal }
                    );
                } else {
                    let pending = drafts.current.get(resourceKey);

                    if (!pending) {
                        pending = new CreateDraftCommand(repository).execute(
                            props.resource
                        );
                        drafts.current.set(resourceKey, pending);
                        void pending.catch(() => drafts.current.delete(resourceKey));
                    }

                    manifest = await pending;
                }

                if (epoch.current !== generation || controller.signal.aborted) {
                    return;
                }

                const document = new EditorDocument(manifest);
                const branch = await new LoadBranchQuery(repository).execute(
                    { snapshot: manifest.snapshot, nodeId: manifest.rootNodeId },
                    { signal: controller.signal }
                );

                if (epoch.current !== generation || controller.signal.aborted) {
                    return;
                }

                const next: Session = {
                    identity: resourceKey,
                    document,
                    repository,
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
    }, [resourceKey, retry, scene, createDependencies]);

    const activeSession = session?.identity === resourceKey ? session : null;
    const model = useMemo(() => {
        if (!activeSession) {
            return {
                ...emptyModel,
                state: error ? ('failed' as const) : ('loading' as const),
            };
        }

        const projection = projectDocument(
            activeSession.document,
            activeSession.view,
            activeSession.template,
            version
        );

        return demo
            ? projectEvidence(projection, activeSession.view, activeSession.template)
            : projection;
    }, [activeSession, version, error, demo]);

    function mutate(action: (target: Session) => void): void {
        const current = sessionRef.current;

        if (!current) {
            return;
        }

        try {
            action(current);

            if (!saveBlocked) {
                setMessage(null);
            }

            refresh();
        } catch (reason) {
            setMessage(errorText(reason));
        }
    }

    function select(selection: BoardSelection | null): void {
        mutate(target => {
            target.view.selection = selection;
        });
    }

    async function expand(
        blockId: string,
        memberId: string,
        expanded: boolean
    ): Promise<void> {
        const target = sessionRef.current;

        if (!target) {
            return;
        }

        const key = `${blockId}/${memberId}`;

        if (demo && observedPreview(target.view, target.template, blockId)) {
            target.view.expanded.set(key, expanded);
            refresh();

            return;
        }

        reads.current.get(key)?.abort();
        target.view.expanded.set(key, expanded);
        refresh();

        if (
            !expanded ||
            target.view.connections.some(
                connection =>
                    connection.sourceBlockId === blockId &&
                    connection.sourceMemberId === memberId
            )
        ) {
            return;
        }

        const row = memberInDocument(target.document, memberId);

        if (!row) {
            setMessage('Load this field before expanding it.');

            return;
        }

        const generation = epoch.current;
        const snapshot = target.document.manifest.snapshot;
        const variant = target.view.variants.get(blockId);
        const controller = new AbortController();
        reads.current.set(key, controller);

        try {
            const branch = await new LoadBranchQuery(target.repository).execute(
                { snapshot, nodeId: row.member.valueNodeId },
                { signal: controller.signal }
            );

            if (
                controller.signal.aborted ||
                epoch.current !== generation ||
                sessionRef.current !== target ||
                target.document.manifest.snapshot.revision !== snapshot.revision ||
                target.view.expanded.get(key) !== true ||
                target.view.variants.get(blockId) !== variant
            ) {
                return;
            }

            const childId = row.member.valueNodeId;
            integrate(target, branch, childId);
            target.view.connections.push({
                id: key,
                sourceBlockId: blockId,
                sourceMemberId: memberId,
                targetBlockId: childId,
                kind: 'containment',
                state: 'normal',
            });
            refresh();
        } catch (reason) {
            if (
                !controller.signal.aborted &&
                epoch.current === generation &&
                sessionRef.current === target &&
                target.document.manifest.snapshot.revision === snapshot.revision &&
                target.view.variants.get(blockId) === variant
            ) {
                target.view.expanded.set(key, false);
                setMessage(errorText(reason));
                refresh();
            }
        } finally {
            if (reads.current.get(key) === controller) {
                reads.current.delete(key);
            }
        }
    }

    async function rename(input: BoardEventMap['rename']): Promise<void> {
        const target = sessionRef.current;

        if (
            target &&
            demo &&
            observedPreview(target.view, target.template, input.blockId)
        ) {
            setMessage(
                'This is an observed variant preview. Return to the draft variant to edit fields.'
            );

            return;
        }

        const row = target && memberInDocument(target.document, input.memberId);

        if (!target || !row) {
            setMessage('Load this field before renaming it.');

            return;
        }

        const generation = epoch.current;
        const snapshot = target.document.manifest.snapshot;
        const variant = target.view.variants.get(input.blockId);

        try {
            if (
                row.member.kind === 'xmlParticle' &&
                !target.document.nodes.has(row.member.valueNodeId)
            ) {
                const key = `rename/${input.memberId}`;
                reads.current.get(key)?.abort();
                const controller = new AbortController();
                reads.current.set(key, controller);
                const node = await new ReadSchemaNodeQuery(target.repository).execute(
                    { snapshot, nodeId: row.member.valueNodeId },
                    { signal: controller.signal }
                );

                if (
                    controller.signal.aborted ||
                    generation !== epoch.current ||
                    sessionRef.current !== target ||
                    target.document.manifest.snapshot.revision !== snapshot.revision ||
                    target.view.variants.get(input.blockId) !== variant
                ) {
                    return;
                }

                target.document.nodes.set(node.id, node);
            }

            mutate(current => current.document.rename(input.memberId, input.name));
        } catch (reason) {
            if (generation === epoch.current && sessionRef.current === target) {
                setMessage(errorText(reason));
            }
        }
    }

    async function loadMore(input: BoardEventMap['loadMore']): Promise<void> {
        const target = sessionRef.current;
        const window = target?.document.collections.get(input.collectionId);

        if (!target || !window || window.state === 'loading') {
            return;
        }

        const generation = epoch.current;
        const snapshot = target.document.manifest.snapshot;
        const variant = target.view.variants.get(input.blockId);
        const key = `page/${input.collectionId}`;
        reads.current.get(key)?.abort();
        const controller = new AbortController();
        reads.current.set(key, controller);
        const loadingWindow = { ...window, state: 'loading' as const, error: undefined };
        target.document.collections.set(input.collectionId, loadingWindow);
        refresh();

        try {
            const page = await new ReadSchemaMembersQuery(target.repository).execute(
                { snapshot, collectionId: input.collectionId, cursor: window.nextCursor },
                { signal: controller.signal }
            );

            if (
                controller.signal.aborted ||
                epoch.current !== generation ||
                sessionRef.current !== target ||
                target.document.manifest.snapshot.revision !== snapshot.revision ||
                target.view.variants.get(input.blockId) !== variant
            ) {
                return;
            }

            target.document.addPage(page, 'append', expandedMembers(target));
            refresh();
        } catch (reason) {
            if (
                !controller.signal.aborted &&
                epoch.current === generation &&
                sessionRef.current === target &&
                target.document.manifest.snapshot.revision === snapshot.revision &&
                target.view.variants.get(input.blockId) === variant
            ) {
                target.document.collections.set(input.collectionId, {
                    ...window,
                    state: 'failed',
                    error: errorText(reason),
                });
                refresh();
            }
        } finally {
            if (reads.current.get(key) === controller) {
                reads.current.delete(key);
            }

            if (
                target.document.collections.get(input.collectionId) === loadingWindow &&
                epoch.current === generation &&
                sessionRef.current === target
            ) {
                target.document.collections.set(input.collectionId, window);
                refresh();
            }
        }
    }

    async function save(): Promise<void> {
        const target = sessionRef.current;

        if (!target || busy || saveBlocked || target.document.operations.length === 0) {
            return;
        }

        const generation = epoch.current;
        const mutationId = crypto.randomUUID();
        setBusy(true);
        setMessage(null);

        try {
            let receipt = await new SaveSchemaCommand(target.repository).execute({
                document: target.document,
                mutationId,
            });

            if (generation !== epoch.current || target !== sessionRef.current) {
                return;
            }

            const poll = new AbortController();
            reads.current.set('save-poll', poll);

            for (let count = 0; receipt.status === 'pending' && count < 40; count += 1) {
                await new Promise<void>(resolve => window.setTimeout(resolve, 500));

                if (
                    poll.signal.aborted ||
                    generation !== epoch.current ||
                    target !== sessionRef.current
                ) {
                    return;
                }

                const next = await new ReadSchemaChangeQuery(target.repository).execute(
                    {
                        schemaId: target.document.manifest.snapshot.id,
                        changeId: receipt.id,
                    },
                    { signal: poll.signal }
                );

                if (
                    next.id !== receipt.id ||
                    next.clientMutationId !== receipt.clientMutationId
                ) {
                    throw new Error(
                        'The server returned another changeset. Your local edits are preserved.'
                    );
                }

                receipt = next;
            }

            if (generation !== epoch.current || target !== sessionRef.current) {
                return;
            }

            finishSave(target, receipt, demo);
            refresh();
        } catch (reason) {
            if (generation === epoch.current && target === sessionRef.current) {
                if (
                    reason instanceof SchemaWriteRejectedError &&
                    reason.reason === 'conflict'
                ) {
                    setSaveBlocked(true);
                }

                setMessage(errorText(reason));
                refresh();
            }
        } finally {
            if (generation === epoch.current) {
                setBusy(false);
            }
        }
    }

    function finishSave(target: Session, receipt: ChangeReceipt, local: boolean): void {
        if (receipt.status === 'applied' && receipt.revision !== null) {
            if (target.document.manifest.snapshot.revision !== receipt.revision) {
                target.document.confirmSave(receipt.revision, receipt.clientMutationId);
            }

            setMessage(
                local
                    ? 'Saved locally in this demo session.'
                    : 'The server applied your changes.'
            );

            if (!local) {
                if (props.resource.kind === 'analysis') {
                    drafts.current.set(
                        resourceKey,
                        Promise.resolve(target.document.manifest)
                    );
                }

                callbacks.current.onSaved?.({
                    schemaId: target.document.manifest.snapshot.id,
                    revision: receipt.revision,
                    savedAt: new Date().toISOString(),
                });
            }
        } else if (receipt.status === 'pending') {
            setMessage(
                'The server is still processing this save. Retry to check the same changeset.'
            );
        } else {
            if (receipt.status === 'conflicted') {
                setSaveBlocked(true);
            }

            target.document.failSave(receipt.clientMutationId);
            setMessage(
                receipt.error ??
                    'The server could not apply these changes. Your local edits are preserved; reconcile before retrying.'
            );
        }
    }

    const handlers: BoardHandlers = {
        select,
        rename: input => {
            void rename(input);
        },
        move: input =>
            mutate(target => {
                if (input.kind === 'card') {
                    target.view.positions.set(input.blockId, input.position);

                    return;
                }

                if (
                    demo &&
                    (observedPreview(target.view, target.template, input.sourceBlockId) ||
                        observedPreview(
                            target.view,
                            target.template,
                            input.targetBlockId
                        ))
                ) {
                    throw new Error(
                        'Observed variant fields are read only. Return to the draft variant before moving fields.'
                    );
                }

                const row = memberInDocument(target.document, input.memberId);
                let collectionId = input.targetCollectionId;

                const destination = model.cards.find(
                    card => card.blockId === input.targetBlockId
                );

                if (row && destination) {
                    collectionId =
                        collectionForMember(
                            target.document,
                            destination.nodeId,
                            row.member.kind
                        ) ?? collectionId;
                }

                target.document.move(input.memberId, collectionId, input.beforeMemberId);
            }),
        expand: input => {
            void expand(input.blockId, input.memberId, input.expanded);
        },
        loadMore: input => {
            void loadMore(input);
        },
        add: () =>
            setMessage(
                'Adding new schema nodes is unavailable in this editor. Loaded fields can be renamed and moved.'
            ),
        variantChange: input =>
            mutate(target => {
                const card = model.cards.find(card => card.blockId === input.blockId);

                if (
                    !card?.variants?.some(
                        variant =>
                            variant.variantId === input.variantId &&
                            variant.scopeId === input.scopeId
                    )
                ) {
                    throw new Error(
                        'This variant does not belong to the displayed context.'
                    );
                }

                target.view.variants.set(input.blockId, input.variantId);
            }),
        hover: () => undefined,
        viewportChange: () => undefined,
    };

    return {
        model,
        handlers,
        demo,
        session: activeSession,
        message,
        error,
        busy,
        saveBlocked,
        resourceKey: `${resourceKey}/${retry}`,
        title: activeSession?.document.manifest.title ?? 'Schema editor',
        canUndo: activeSession?.document.canUndo ?? false,
        canRedo: activeSession?.document.canRedo ?? false,
        pendingChanges: activeSession?.document.operations.length ?? 0,
        select,
        expand,
        save,
        undo: () => mutate(target => target.document.undo()),
        redo: () => mutate(target => target.document.redo()),
        retry: () => setRetry(value => value + 1),
    };
}

function errorText(reason: unknown): string {
    return reason instanceof Error ? reason.message : 'The schema operation failed.';
}

function collectionForMember(
    document: EditorDocument,
    nodeId: string,
    kind: SchemaMember['kind']
): string | null {
    let node = document.nodes.get(nodeId);
    const seen = new Set<string>();

    while (node && !seen.has(node.id) && seen.size < 8) {
        seen.add(node.id);

        if (kind === 'xmlAttribute' && node.kind === 'xmlComplex') {
            return node.attributes.id;
        }

        if (kind === 'xmlParticle' && node.kind === 'xmlGroup') {
            return node.particles.id;
        }

        if (kind === 'property' && node.kind === 'object') {
            return node.properties.id;
        }

        if (kind === 'option' && node.kind === 'union') {
            return node.options.id;
        }

        const next =
            node.kind === 'xmlElement'
                ? node.contentNodeId
                : node.kind === 'xmlComplex'
                  ? node.particleNodeId
                  : node.kind === 'array'
                    ? node.itemsNodeId
                    : null;
        node = next === null ? undefined : document.nodes.get(next);
    }

    return null;
}
