import { useState, type KeyboardEvent } from 'react';
import type { BoardCard, BoardModel, BoardSelection } from '../board/model/types';
import styles from './EditorShell.module.css';

export type EditorShellProps = {
    model: BoardModel;
    title: string;
    mode: 'evidence' | 'builder';
    presentation?: 'main' | 'comparison';
    demo: boolean;
    busy: boolean;
    saveBlocked?: boolean;
    canUndo: boolean;
    canRedo: boolean;
    pendingChanges: number;
    zoom: number;
    message: string | null;
    onSelect(selection: BoardSelection): void;
    onExpand(blockId: string, memberId: string, expanded: boolean): void;
    onVariant?(blockId: string, variantId: string, scopeId: string): void;
    onPreview?(): void;
    onFit(): void;
    onArrange?(): void;
    onZoom(zoom: number): void;
    onUndo(): void;
    onRedo(): void;
    onSave(): void;
    onExit?(): void;
};

function navigateTree(event: KeyboardEvent<HTMLElement>): void {
    const items = [
        ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="treeitem"]'),
    ];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = index;

    if (event.key === 'ArrowDown') {
        next = Math.min(items.length - 1, index + 1);
    } else if (event.key === 'ArrowUp') {
        next = Math.max(0, index - 1);
    } else if (event.key === 'Home') {
        next = 0;
    } else if (event.key === 'End') {
        next = items.length - 1;
    } else {
        return;
    }

    event.preventDefault();
    items[next]?.focus();
}

function NodeIcon({ attribute = false }: { attribute?: boolean }): React.JSX.Element {
    return attribute ? (
        <span className={styles.icon}>@</span>
    ) : (
        <svg
            className={styles.icon}
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="m5.5 4-3 3 3 3m3-6 3 3-3 3" />
        </svg>
    );
}

const palette = [
    ['<>', 'Element'],
    ['@', 'Attribute'],
    ['1,2', 'Sequence'],
    ['1|2', 'Choice'],
    ['{ }', 'All'],
    ['#', 'Definition'],
    ['↗', 'Reference'],
] as const;

export default function EditorShell(props: EditorShellProps): React.JSX.Element {
    const [mode, setMode] = useState(props.mode);
    const [tab, setTab] = useState<'structure' | 'definitions'>('structure');
    const [search, setSearch] = useState('');
    const [openTree, setOpenTree] = useState(new Set<string>());
    const [notice, setNotice] = useState<string | null>(null);
    const selected = props.model.cards.find(
        card => card.blockId === props.model.selection?.blockId
    );
    const selectedRow = selected?.rows.find(
        row => row.memberId === props.model.selection?.memberId
    );
    const connection = props.model.connections.find(
        edge =>
            edge.sourceBlockId === selected?.blockId &&
            edge.sourceMemberId === selectedRow?.memberId
    );
    const inspected =
        props.model.cards.find(card => card.blockId === connection?.targetBlockId) ??
        selected;
    const variants = inspected?.variants;
    const activeVariant =
        variants?.find(variant => variant.variantId === inspected?.activeVariantId) ??
        variants?.[0];
    const incoming = new Set(props.model.connections.map(edge => edge.targetBlockId));
    const roots = props.model.cards.filter(card => !incoming.has(card.blockId));
    const root =
        roots.find(card =>
            props.model.connections.some(edge => edge.sourceBlockId === card.blockId)
        ) ?? roots[0];
    const definitions = roots.filter(card => card.blockId !== root?.blockId);
    const currentName = selectedRow?.name ?? inspected?.title;
    const path =
        selectedRow && selected
            ? `${selected.title} / ${selectedRow.name}`
            : inspected?.title;

    function choose(selection: BoardSelection): void {
        props.onSelect(selection);
        setNotice(null);
    }

    function treeCard(
        card: BoardCard,
        depth: number,
        seen: Set<string>
    ): React.JSX.Element | null {
        if (seen.has(card.blockId)) {
            return null;
        }

        const nextSeen = new Set(seen).add(card.blockId);
        const expanded = depth === 0 || openTree.has(card.blockId);

        return (
            <div role="none" key={card.blockId}>
                <button
                    className={styles.treeItem}
                    role="treeitem"
                    aria-level={depth + 1}
                    aria-expanded={expanded}
                    aria-selected={
                        props.model.selection?.blockId === card.blockId &&
                        props.model.selection.memberId === null
                    }
                    style={{ paddingLeft: 10 + depth * 16 }}
                    onClick={() => choose({ blockId: card.blockId, memberId: null })}
                    onKeyDown={event => {
                        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                            event.preventDefault();
                            setOpenTree(previous => {
                                const next = new Set(previous);

                                if (event.key === 'ArrowRight') {
                                    next.add(card.blockId);
                                } else {
                                    next.delete(card.blockId);
                                }

                                return next;
                            });
                        }
                    }}
                >
                    <NodeIcon />
                    <span>{card.title}</span>
                    <span className={styles.count}>
                        {card.rowWindow.hasMore
                            ? `${card.rows.length}/${card.rowWindow.totalItems}`
                            : card.rowWindow.totalItems}
                    </span>
                </button>
                {expanded && (
                    <div role="group" className={styles.treeChildren}>
                        {card.rows.map(row => {
                            const edge = props.model.connections.find(
                                edge =>
                                    edge.sourceBlockId === card.blockId &&
                                    edge.sourceMemberId === row.memberId
                            );
                            const child = props.model.cards.find(
                                child => child.blockId === edge?.targetBlockId
                            );
                            const active =
                                (props.model.selection?.blockId === card.blockId &&
                                    props.model.selection.memberId === row.memberId) ||
                                props.model.selection?.blockId === child?.blockId;

                            return (
                                <div role="none" key={row.memberId}>
                                    <button
                                        role="treeitem"
                                        aria-level={depth + 2}
                                        aria-selected={active}
                                        aria-expanded={
                                            row.expandable
                                                ? openTree.has(
                                                      child?.blockId ?? row.memberId
                                                  )
                                                : undefined
                                        }
                                        className={styles.treeItem}
                                        style={{ paddingLeft: 26 + depth * 16 }}
                                        onClick={() =>
                                            choose({
                                                blockId: card.blockId,
                                                memberId: row.memberId,
                                            })
                                        }
                                        onKeyDown={event => {
                                            if (
                                                row.expandable &&
                                                (event.key === 'ArrowRight' ||
                                                    event.key === 'ArrowLeft')
                                            ) {
                                                event.preventDefault();
                                                const expanded =
                                                    event.key === 'ArrowRight';
                                                setOpenTree(previous => {
                                                    const next = new Set(previous);

                                                    if (expanded) {
                                                        next.add(
                                                            child?.blockId ?? row.memberId
                                                        );
                                                    } else {
                                                        next.delete(
                                                            child?.blockId ?? row.memberId
                                                        );
                                                    }

                                                    return next;
                                                });

                                                if (!child) {
                                                    props.onExpand(
                                                        card.blockId,
                                                        row.memberId,
                                                        expanded
                                                    );
                                                }
                                            }
                                        }}
                                    >
                                        <span
                                            className={styles.treeGuide}
                                            style={{ left: 17 + depth * 16 }}
                                        />
                                        <NodeIcon attribute={row.icon === 'attribute'} />
                                        <span>{row.name}</span>
                                        <span
                                            className={
                                                row.variantsCount
                                                    ? styles.variantCount
                                                    : styles.count
                                            }
                                        >
                                            {row.variantsCount
                                                ? `${row.variantsCount} var`
                                                : child
                                                  ? child.rowWindow.hasMore
                                                      ? `${child.rows.length}/${child.rowWindow.totalItems}`
                                                      : child.rowWindow.totalItems
                                                  : row.typeLabel}
                                        </span>
                                    </button>
                                    {child &&
                                        openTree.has(child.blockId) &&
                                        treeCard(child, depth + 1, nextSeen)}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        );
    }

    if (props.presentation === 'comparison') {
        const fields = inspected?.rows ?? [];

        return (
            <div className={styles.shell}>
                <aside
                    className={`${styles.panel} ${styles.comparison}`}
                    aria-label="Variant comparison"
                >
                    <div className={styles.comparisonHeading}>
                        <h1>Variants of {inspected?.title ?? 'payment'}</h1>
                        <span>
                            {variants?.length ?? 0} structures across{' '}
                            {activeVariant?.total ?? 0} orders
                        </span>
                    </div>
                    <div className={styles.comparisonMetrics}>
                        {[
                            [
                                fields.filter(row => row.change === 'unchanged').length,
                                'shared',
                            ],
                            [
                                fields.filter(row => row.change === 'removed').length,
                                'only in Card',
                            ],
                            [
                                fields.filter(row => row.change === 'added').length,
                                'only in Invoice',
                            ],
                        ].map(([count, label]) => (
                            <div key={label}>
                                <strong>{count}</strong>
                                <span>{label}</span>
                            </div>
                        ))}
                    </div>
                    <div className={styles.comparisonWarning}>
                        <strong>Card fields leave with Card</strong>
                        <span>number and holder are absent from Invoice.</span>
                        <span>
                            Viewing this structure preserves the draft and its manual
                            edits.
                        </span>
                    </div>
                    <section className={`${styles.section} ${styles.comparisonChoices}`}>
                        <h2>What to do with the draft</h2>
                        <button className={styles.primary} onClick={props.onPreview}>
                            Preview {activeVariant?.title ?? 'Invoice'}
                        </button>
                        {[
                            ['Allow both', 'Adds an xs:choice with two branches'],
                            [
                                'Merge and relax',
                                'All fields, the differing ones optional. Allows combinations never observed.',
                            ],
                            ['Build custom', 'A manual copy that remembers its origin'],
                        ].map(([label, description]) => (
                            <button
                                key={label}
                                className={styles.comparisonChoice}
                                aria-disabled="true"
                                onClick={() =>
                                    setNotice(
                                        'Applying or merging evidence is unavailable. The observed variant is a read-only preview.'
                                    )
                                }
                            >
                                <strong>{label}</strong>
                                <span>{description}</span>
                            </button>
                        ))}
                    </section>
                    {(props.message || notice) && (
                        <p role="status" className={styles.message}>
                            {props.message ?? notice}
                        </p>
                    )}
                    <div className={styles.comparisonFooter}>
                        <span>Demo preview · draft unchanged</span>
                        <span>Ctrl Z</span>
                    </div>
                </aside>
            </div>
        );
    }

    return (
        <div className={styles.shell}>
            <header className={`${styles.panel} ${styles.toolbar}`}>
                <div className={styles.projectTitle}>
                    {props.onExit && (
                        <button
                            className={styles.button}
                            onClick={props.onExit}
                            aria-label="Exit editor"
                        >
                            ‹
                        </button>
                    )}
                    <strong>{props.title}</strong>
                    <span className={styles.secondary}>XSD 1.0</span>
                </div>
                <div className={styles.segment} role="group" aria-label="Editor mode">
                    <button
                        aria-pressed={mode === 'builder'}
                        onClick={() => setMode('builder')}
                    >
                        Builder
                    </button>
                    <button
                        aria-pressed={mode === 'evidence'}
                        onClick={() => setMode('evidence')}
                    >
                        Evidence
                    </button>
                </div>
                <label className={styles.search}>
                    <svg
                        width="14"
                        height="14"
                        viewBox="0 0 14 14"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        aria-hidden="true"
                    >
                        <circle cx="6" cy="6" r="4.5" />
                        <path d="m9.5 9.5 3.5 3.5" />
                    </svg>
                    <input
                        aria-label="Search loaded schema"
                        placeholder="Search the loaded schema"
                        value={search}
                        onChange={event => setSearch(event.target.value)}
                    />
                </label>
                <div className={styles.toolbarActions}>
                    <button
                        className={styles.iconButton}
                        aria-label="Undo"
                        disabled={!props.canUndo}
                        onClick={props.onUndo}
                    >
                        ↶
                    </button>
                    <button
                        className={styles.iconButton}
                        aria-label="Redo"
                        disabled={!props.canRedo}
                        onClick={props.onRedo}
                    >
                        ↷
                    </button>
                    <button
                        className={styles.saveStatus}
                        aria-label={props.demo ? 'Save in demo' : 'Save schema'}
                        disabled={
                            props.busy || props.saveBlocked || props.pendingChanges === 0
                        }
                        onClick={props.onSave}
                    >
                        {props.busy
                            ? 'Saving...'
                            : props.pendingChanges
                              ? `Save ${props.pendingChanges} changes`
                              : props.demo
                                ? 'Demo · saved locally'
                                : 'No local changes'}
                    </button>
                    <button
                        className={styles.primary}
                        onClick={() =>
                            setNotice(
                                'XSD export requires the schema API export endpoint. This editor has not exported a file.'
                            )
                        }
                        title="XSD export is unavailable"
                    >
                        Export
                    </button>
                </div>
            </header>

            <nav
                className={`${styles.panel} ${styles.navigator}`}
                aria-label="Schema navigator"
            >
                <div
                    className={`${styles.segment} ${styles.navigatorTabs}`}
                    role="group"
                    aria-label="Navigator view"
                >
                    <button
                        aria-pressed={tab === 'structure'}
                        onClick={() => setTab('structure')}
                    >
                        Structure
                    </button>
                    <button
                        aria-pressed={tab === 'definitions'}
                        onClick={() => setTab('definitions')}
                    >
                        Definitions
                    </button>
                </div>
                <div className={styles.separator} />
                <div
                    className={styles.tree}
                    role="tree"
                    aria-label="Schema structure"
                    onKeyDown={navigateTree}
                >
                    {search
                        ? props.model.cards.flatMap(card =>
                              card.rows
                                  .filter(row =>
                                      row.name
                                          .toLowerCase()
                                          .includes(search.toLowerCase())
                                  )
                                  .map(row => (
                                      <button
                                          key={`${card.blockId}/${row.memberId}`}
                                          role="treeitem"
                                          className={styles.treeItem}
                                          aria-selected={
                                              props.model.selection?.memberId ===
                                              row.memberId
                                          }
                                          onClick={() =>
                                              choose({
                                                  blockId: card.blockId,
                                                  memberId: row.memberId,
                                              })
                                          }
                                      >
                                          <NodeIcon
                                              attribute={row.icon === 'attribute'}
                                          />
                                          <span>{row.name}</span>
                                          <span className={styles.count}>
                                              {card.title}
                                          </span>
                                      </button>
                                  ))
                          )
                        : tab === 'structure'
                          ? root && treeCard(root, 0, new Set())
                          : definitions.map(card => treeCard(card, 0, new Set()))}
                </div>
                <div className={styles.separator} />
                <div className={styles.sectionLabel}>Palette</div>
                <div className={styles.palette}>
                    {palette.map(([icon, label]) => (
                        <button
                            key={label}
                            className={styles.paletteItem}
                            aria-disabled="true"
                            onClick={() =>
                                setNotice(
                                    'Adding new schema nodes is unavailable in this editor. Loaded fields can be renamed and moved.'
                                )
                            }
                        >
                            <span>{icon}</span>
                            {label}
                        </button>
                    ))}
                </div>
            </nav>

            <aside
                className={`${styles.panel} ${styles.inspector}`}
                aria-label="Selection inspector"
            >
                {inspected ? (
                    <>
                        <div className={styles.inspectorTitle}>
                            <div>
                                <strong>{currentName}</strong>
                                <span>element</span>
                            </div>
                            <span className={styles.path}>{path}</span>
                        </div>
                        <div className={styles.separator} />
                        <div className={styles.propertyGrid}>
                            <label className={styles.fullProperty}>
                                Namespace
                                <input
                                    readOnly
                                    value={
                                        inspected.namespace ??
                                        (props.demo && variants ? 'urn:shop:orders' : '')
                                    }
                                />
                            </label>
                            <label>
                                minOccurs
                                <input
                                    readOnly
                                    value={
                                        selectedRow?.occurrenceLabel?.split('..')[0] ??
                                        '1'
                                    }
                                />
                            </label>
                            <label>
                                maxOccurs
                                <input
                                    readOnly
                                    value={
                                        selectedRow?.occurrenceLabel?.split('..')[1] ??
                                        '1'
                                    }
                                />
                            </label>
                        </div>
                        <div className={styles.separator} />
                        {mode === 'evidence' && variants && activeVariant ? (
                            <>
                                <section className={styles.section}>
                                    <h2>Variants in {activeVariant.total} orders</h2>
                                    {variants.map(variant => (
                                        <button
                                            key={variant.variantId}
                                            className={styles.variantMetric}
                                            aria-pressed={
                                                variant.variantId ===
                                                activeVariant.variantId
                                            }
                                            onClick={() =>
                                                props.onVariant?.(
                                                    inspected.blockId,
                                                    variant.variantId,
                                                    variant.scopeId
                                                )
                                            }
                                        >
                                            <span>{variant.title}</span>
                                            <span className={styles.metricTrack}>
                                                <span
                                                    style={{
                                                        width: `${(variant.count / Math.max(1, variant.total)) * 100}%`,
                                                    }}
                                                />
                                            </span>
                                            <span>
                                                {variant.count}
                                                <span className={styles.secondary}>
                                                    /{variant.total}
                                                </span>
                                            </span>
                                        </button>
                                    ))}
                                    <p>Share of order occurrences, not of documents.</p>
                                    <button
                                        className={styles.primary}
                                        onClick={() =>
                                            props.onVariant?.(
                                                inspected.blockId,
                                                activeVariant.variantId,
                                                activeVariant.scopeId
                                            )
                                        }
                                    >
                                        View {activeVariant.title}
                                    </button>
                                    <div className={styles.evidenceActions}>
                                        {[
                                            ['Allow both', 'xs:choice'],
                                            ['Merge fields', 'looser schema'],
                                            ['Build custom', 'keeps origin'],
                                        ].map(([label, hint]) => (
                                            <button
                                                key={label}
                                                aria-disabled="true"
                                                onClick={() =>
                                                    setNotice(
                                                        'Applying evidence requires a semantic preview and confirmation. This demo supports observing variants only.'
                                                    )
                                                }
                                            >
                                                <span>{label}</span>
                                                <span>{hint}</span>
                                            </button>
                                        ))}
                                    </div>
                                </section>
                                <div className={styles.separator} />
                                <section className={styles.section}>
                                    <h2>Names</h2>
                                    <div className={styles.nameMetric}>
                                        <span>{currentName}</span>
                                        <span>
                                            {props.demo ? 14 : activeVariant.total}
                                        </span>
                                    </div>
                                    {props.demo && (
                                        <div className={styles.nameMetric}>
                                            <span>paymnet</span>
                                            <i>likely a typo</i>
                                            <span>1</span>
                                        </div>
                                    )}
                                    <button
                                        className={styles.textButton}
                                        onClick={() =>
                                            setNotice(
                                                'Observed spelling variants remain separate in this demo.'
                                            )
                                        }
                                    >
                                        Keep separate
                                    </button>
                                </section>
                                <div className={styles.separator} />
                                {props.demo && (
                                    <section className={styles.section}>
                                        <h2>Sources · 3 of 10</h2>
                                        <div className={styles.sources}>
                                            {[
                                                'orders_0412.xml',
                                                'orders_0413.xml',
                                                'batch_07.xml',
                                            ].map((file, index) => (
                                                <span key={file}>
                                                    {file}{' '}
                                                    <span>
                                                        /order[{index === 2 ? 3 : 1}
                                                        ]/payment
                                                    </span>
                                                </span>
                                            ))}
                                        </div>
                                        <button
                                            className={styles.textButton}
                                            onClick={() =>
                                                setNotice(
                                                    'These are the three source examples available in this demo fixture.'
                                                )
                                            }
                                        >
                                            Next page
                                        </button>
                                    </section>
                                )}
                            </>
                        ) : (
                            <section className={styles.section}>
                                <h2>Loaded structure</h2>
                                <p>
                                    {inspected.rows.length} of{' '}
                                    {inspected.rowWindow.totalItems} fields loaded.
                                </p>
                                <p>
                                    Press F2 on the board to rename a loaded field. Drag
                                    its handle to move it.
                                </p>
                            </section>
                        )}
                    </>
                ) : (
                    <p className={styles.description}>
                        Select a block or field on the board or in the navigator.
                    </p>
                )}
                {(props.message || notice) && (
                    <p role="status" className={styles.message}>
                        {props.message ?? notice}
                    </p>
                )}
            </aside>

            <div
                className={`${styles.panel} ${styles.viewportControls}`}
                aria-label="Board viewport controls"
            >
                <button
                    className={styles.iconButton}
                    aria-label="Zoom out"
                    onClick={() => props.onZoom(props.zoom / 1.2)}
                >
                    −
                </button>
                <span className={styles.zoom}>{Math.round(props.zoom * 100)}%</span>
                <button
                    className={styles.iconButton}
                    aria-label="Zoom in"
                    onClick={() => props.onZoom(props.zoom * 1.2)}
                >
                    +
                </button>
                <button
                    className={styles.detailButton}
                    onClick={props.onFit}
                    title="Fit the loaded structure"
                >
                    {props.zoom < 0.35
                        ? 'Overview'
                        : props.zoom > 0.75
                          ? 'Working detail'
                          : 'Working detail'}
                </button>
                <button
                    className={styles.arrange}
                    onClick={props.onArrange ?? props.onFit}
                >
                    Arrange
                </button>
            </div>
        </div>
    );
}
