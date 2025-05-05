import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { XSDType } from '@entities/node';
import { useSafelyWorkingSchemaController } from '@features/WorkingSchemaContext';

import { useReactiveState } from '../../../../../interfaces/Reactive/useReactiveState';
import { ExpressionNodeType, SchemaNode, SchemaNodeModel } from '../../../../../model/treeModel';
import { bem } from '../../../../../shared/bem/bem';
import './TreeNodeBody.scss';

const block = bem('TreeNodeData');

type TreeNodeBodyProps = {
    ref?: React.Ref<HTMLDivElement>;
    node: SchemaNode<SchemaNodeModel>;
    choosable: boolean;
};

export const TreeNodeBody = ({ ref, node, choosable }: TreeNodeBodyProps) => {
    const nodeData = node.getInternalData();
    const workingSchemaController = useSafelyWorkingSchemaController();

    const isChosen = useReactiveState(node, state => state.chosen);
    const chosenAttributes = useReactiveState(node, state => state.chosenAttributes);

    const accentIsVisible = nodeData.type === ExpressionNodeType.LEAF;

    let valueToDisplay = nodeData.value;
    if (nodeData.type === ExpressionNodeType.LEAF) {
        valueToDisplay = nodeData.value.split('/')[1].split('-')[0];
    }

    const attributesToDisplay = useMemo(() => {
        const result: Array<{ name: string; type: XSDType; probability: number }> = [];

        if (nodeData.type !== ExpressionNodeType.LEAF) {
            return result;
        }

        const nativeAttributes = workingSchemaController.getSchemaData()[nodeData.value].attributes;

        for (const attr of chosenAttributes) {
            let bestType = XSDType.STRING;
            let bestProb = -Infinity;

            if (!nativeAttributes[attr]) {
                continue;
            }

            Object.entries(nativeAttributes[attr].XSDTypes).forEach(([name, prob]) => {
                if (prob > bestProb) {
                    bestProb = prob;
                    bestType = name as XSDType;
                }
            });

            result.push({
                name: attr,
                type: bestType,
                probability: nativeAttributes[attr].probability,
            });
        }

        return result;
    }, [chosenAttributes]);

    const chooseThisNodeSubtree = useCallback(
        (event: React.MouseEvent<HTMLDivElement>) => {
            event.preventDefault();
            event.stopPropagation();

            if (!choosable) {
                console.log('not choosable');
                return;
            }

            workingSchemaController?.selectSubtree(node.id);
        },
        [node, choosable]
    );

    const inspectThisNode = useCallback(() => {
        workingSchemaController.setInspectableNode(node.id);
    }, [node]);

    return (
        <div
            className={block()}
            ref={ref}
        >
            <div
                className={block('data', { chosen: isChosen })}
                onContextMenu={chooseThisNodeSubtree}
                onClick={inspectThisNode}
            >
                <span className={block('value')}>
                    {accentIsVisible && <span className={block('value-accent')}>{'<'}</span>}
                    <span className="representation">
                        <b>{valueToDisplay}</b>
                        {attributesToDisplay.map(attr => (
                            <span
                                key={attr.name}
                                className="attribute"
                                style={{ opacity: Math.max(attr.probability, 0.5) }}
                            >
                                {attr.name}="<u>{attr.type}</u>"
                            </span>
                        ))}
                    </span>
                    {accentIsVisible && <span className={block('value-accent')}>{' />'}</span>}
                </span>
            </div>
        </div>
    );
};
