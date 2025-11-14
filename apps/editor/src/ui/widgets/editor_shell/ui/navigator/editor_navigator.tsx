import { useState } from 'react';
import type { BoardCard, BoardSelection } from '../../../../../board';
import type { EditorShellProps } from '../../model';
import { navigateTree } from '../../lib/tree_navigation';
import { NodeIcon } from '../node_icon';
import styles from '../EditorShell.module.css';

type NavigatorProps = Pick<EditorShellProps, 'model' | 'onSelect' | 'onExpand'> & {
    search: string;
    setNotice(message: string | null): void;
};

const palette = [
    [
        '<>',
        'Element',
    ],
    [
        '@',
        'Attribute',
    ],
    [
        '1,2',
        'Sequence',
    ],
    [
        '1|2',
        'Choice',
    ],
    [
        '{ }',
        'All',
    ],
    [
        '#',
        'Definition',
    ],
    [
        '↗',
        'Reference',
    ],
] as const;

export function EditorNavigator(props: NavigatorProps): React.JSX.Element {
    const { search, setNotice } = props;
    const [tab, setTab] = useState<'structure' | 'definitions'>('structure');
    const [openTree, setOpenTree] = useState(new Set<string>());
    const incoming = new Set(props.model.connections.map(edge => edge.targetBlockId));
    const roots = props.model.cards.filter(card => !incoming.has(card.blockId));
    const root =
        roots.find(card =>
            props.model.connections.some(edge => edge.sourceBlockId === card.blockId)
        ) ?? roots[0];
    const definitions = roots.filter(card => card.blockId !== root?.blockId);

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
                    style={{
                        paddingLeft: 10 + depth * 16,
                    }}
                    onClick={() =>
                        choose({
                            blockId: card.blockId,
                            memberId: null,
                        })
                    }
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
                                        style={{
                                            paddingLeft: 26 + depth * 16,
                                        }}
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
                                            style={{
                                                left: 17 + depth * 16,
                                            }}
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

    return (
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
                                  row.name.toLowerCase().includes(search.toLowerCase())
                              )
                              .map(row => (
                                  <button
                                      key={`${card.blockId}/${row.memberId}`}
                                      role="treeitem"
                                      className={styles.treeItem}
                                      aria-selected={
                                          props.model.selection?.memberId === row.memberId
                                      }
                                      onClick={() =>
                                          choose({
                                              blockId: card.blockId,
                                              memberId: row.memberId,
                                          })
                                      }
                                  >
                                      <NodeIcon attribute={row.icon === 'attribute'} />
                                      <span>{row.name}</span>
                                      <span className={styles.count}>{card.title}</span>
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
    );
}
