import { memo, useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';

import { ExpressionNodeType, SchemaNode, SchemaNodeModel } from '../../../../model/treeModel';
import { bem } from '../../../../shared/bem/bem';
import { TreeNodeBody } from './components/TreeNodeBody';
import './TreeNode.scss';

const block = bem('TreeNode');

export type TreeNodeProps = {
    node: SchemaNode<SchemaNodeModel>;
    externalConnectorRef?: RefObject<HTMLDivElement | null>;
    refToData?: RefObject<HTMLDivElement | null>;
    choosable?: boolean;
};

// Вспомогательная функция для объединения ref
function mergeRefs<T>(...refs: (React.Ref<T> | undefined)[]): React.RefCallback<T> {
    return (element: T | null) => {
        refs.forEach(ref => {
            if (typeof ref === 'function') {
                ref(element);
            } else if (ref && 'current' in ref) {
                (ref as React.RefObject<T | null>).current = element;
            }
        });
    };
}

// Главные функции - осуществить выбор. Просмотреть инфу.

export const TreeNode = memo(({ node, externalConnectorRef, refToData, choosable = false }: TreeNodeProps) => {
    const lastChildRef = useRef<HTMLDivElement>(null);
    const dataRef = useRef<HTMLDivElement>(null);
    const verticalConnectorRef = useRef<HTMLDivElement>(null);
    const horizontalConnectorRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        if (verticalConnectorRef.current && lastChildRef.current) {
            const connectorRect = verticalConnectorRef.current.getBoundingClientRect();
            const lastChildRect = lastChildRef.current.getBoundingClientRect();

            const connectorHeight = lastChildRect.top + lastChildRect.height / 2 - connectorRect.top;

            verticalConnectorRef.current.style.height = `${connectorHeight}px`;
        }

        if (dataRef.current && externalConnectorRef?.current && horizontalConnectorRef.current) {
            const dataRect = dataRef.current.getBoundingClientRect();
            const externalConRect = externalConnectorRef.current.getBoundingClientRect();

            const horizontalConnectorWidth = dataRect.left - externalConRect.right;

            horizontalConnectorRef.current.style.width = `${horizontalConnectorWidth}px`;
            horizontalConnectorRef.current.style.left = `-${horizontalConnectorWidth + externalConRect.width}px`;
            horizontalConnectorRef.current.style.top = `${dataRect.height / 2}px`;
        }
    }, [
        node.children,
        verticalConnectorRef.current,
        lastChildRef.current,
        dataRef.current,
        externalConnectorRef?.current,
        horizontalConnectorRef.current,
    ]);

    return (
        <div className={block()}>
            <div className={block('data-wrapper')}>
                {/*Сюда надо лейбл для OR и AND и норм данные для LEAF */}
                <TreeNodeBody
                    ref={mergeRefs(refToData, dataRef)}
                    node={node}
                    choosable={choosable}
                />
                <div
                    className={block('connector', { horizontal: true })}
                    ref={horizontalConnectorRef}
                />
            </div>
            <div className={block('tree')}>
                <div
                    className={block('connector', { vertical: true })}
                    ref={verticalConnectorRef}
                />
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
                                refToData={lastChildRef}
                                node={childNode}
                                externalConnectorRef={verticalConnectorRef}
                                choosable={parentNodeData.type === ExpressionNodeType.OR}
                            />
                        );
                    })}
                </div>
            </div>
        </div>
    );
});
