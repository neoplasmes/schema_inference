import { memo, useLayoutEffect, useRef, useState } from 'react';

import { useReactiveState } from '@interfaces/Reactive/useReactiveState';
import { ExpressionNodeType, SchemaNode, SchemaNodeModel } from '@model/treeModel';
import { bem } from '@shared/bem';

import { TreeNodeBody } from './components/TreeNodeBody';
import './TreeNode.scss';

const block = bem('TreeNode');

export type TreeNodeProps = {
    node: SchemaNode<SchemaNodeModel>;
    ref?: React.RefObject<HTMLDivElement | null>;
    parentBodyRef?: React.RefObject<HTMLDivElement | null>;
    isAlternative?: boolean;
    choosable?: boolean;
};

type ProbabilityLayout = {
    left: number;
    top: number;
    width: number;
    padding: number;
};

const mergeRefs = <T,>(...refs: (React.Ref<T> | undefined)[]): React.RefCallback<T> => {
    return (element: T | null) => {
        refs.forEach(ref => {
            if (typeof ref === 'function') {
                ref(element);
            } else if (ref && 'current' in ref) {
                (ref as React.RefObject<T | null>).current = element;
            }
        });
    };
};

/**
 * Path считается в HTML-DOM системе координат (X вправо и Y вниз)
 * относительно верхнего левого угла el2.
 * @param el1
 * @param el2
 */
const calculateConnectorData = (
    el1: HTMLDivElement,
    el2: HTMLDivElement
): { path: string; probabilityLayout: ProbabilityLayout } => {
    const rect1 = el1.getBoundingClientRect();
    const rect2 = el2.getBoundingClientRect();

    const padding = 4;

    const startX = rect1.left - rect2.left - (rect1.left - rect2.left) * 0.2; // будет отрицательное число - то, что нужно
    const startY = rect1.bottom - rect2.top; // нижний край второго элемента

    const endX = 0; // левый край второго элемента
    const endY = rect2.height / 2; // середина второго элемента

    const cornerX = startX;
    const cornerY = endY;

    const curveRadius = 6;
    const curveStartX = cornerX;
    const curveStartY = cornerY - curveRadius;
    const curveEndX = cornerX + curveRadius;
    const curveEndY = cornerY;

    const pathData = `
        M ${startX},${startY + padding}
        V ${curveStartY}
        Q ${cornerX},${cornerY} ${curveEndX},${curveEndY}
        H ${endX - padding}
    `;

    return {
        path: pathData.trim().replace(/\s+/g, ' '),
        probabilityLayout: {
            left: startX,
            top: 0,
            width: endX - startX,
            padding: curveRadius,
        },
    };
};

export const TreeNode = memo(
    ({ node, parentBodyRef, ref, isAlternative = false, choosable = false }: TreeNodeProps) => {
        const [connectorPath, setConnectorPath] = useState('');
        const [probabilityLayout, setProbabilityLayout] = useState<ProbabilityLayout>();
        const currentBodyRef = useRef<HTMLDivElement>(null);

        const isChosen = useReactiveState(node, state => state.chosen);

        useLayoutEffect(() => {
            if (!parentBodyRef?.current || !currentBodyRef.current) {
                return;
            }

            const data = calculateConnectorData(parentBodyRef.current, currentBodyRef.current);
            setConnectorPath(data.path);
            setProbabilityLayout(data.probabilityLayout);
        }, [parentBodyRef, currentBodyRef, node.children]);

        return (
            <div className={block(undefined, { skipped: !isChosen })}>
                {/*Сюда надо лейбл для OR и AND и норм данные для LEAF */}
                {parentBodyRef && (
                    <svg className={block('connector')}>
                        <path
                            d={connectorPath}
                            fill="none"
                        />
                    </svg>
                )}
                {parentBodyRef && probabilityLayout && isAlternative && (
                    <div
                        className={block('probability')}
                        style={{
                            left: probabilityLayout.left,
                            top: probabilityLayout.top,
                            width: probabilityLayout.width,
                            padding: probabilityLayout.padding,
                        }}
                    >
                        <span>{(node.getInternalData().probability * 100).toFixed(0) + '%'}</span>
                    </div>
                )}
                <TreeNodeBody
                    ref={mergeRefs(ref, currentBodyRef)}
                    node={node}
                    choosable={choosable}
                />
                {node.children.length > 0 && (
                    <div className={block('tree')}>
                        <div className={block('children')}>
                            {node.children.map(childNode => {
                                const childNodeData = childNode.getInternalData();
                                const parentNodeData = node.getInternalData();

                                if (!childNodeData.value) {
                                    return null;
                                }

                                return (
                                    <TreeNode
                                        key={childNode.id}
                                        parentBodyRef={currentBodyRef}
                                        node={childNode}
                                        isAlternative={parentNodeData.type === ExpressionNodeType.OR}
                                        choosable={true}
                                    />
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        );
    }
);
