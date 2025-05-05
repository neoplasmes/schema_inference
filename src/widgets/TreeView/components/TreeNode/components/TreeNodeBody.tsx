import { bem } from '../../../../../shared/bem';
import { ExpressionNodeType, SchemaNode, SchemaNodeModel } from '../../../../../model/treeModel';
import { useCallback, useEffect, useRef, useState } from 'react';
import './TreeNodeBody.scss';
import { useWorkingSchemaContext } from '../../../../../features/WorkingSchemaContext/WorkingSchemaContext';
import { useReactiveState } from '../../../../../interfaces/Reactive/useReactiveState';

const block = bem('TreeNodeData');

type TreeNodeBodyProps = {
    ref?: React.Ref<HTMLDivElement>;
    node: SchemaNode<SchemaNodeModel>;
    choosable: boolean;
};

export const TreeNodeBody = ({ ref, node, choosable }: TreeNodeBodyProps) => {
    const nodeData = node.getInternalData();
    const { workingSchemaController } = useWorkingSchemaContext();

    if (!workingSchemaController) {
        throw new Error('aasfasf');
    }

    const isChosen = useReactiveState(node, state => state.chosen);

    const accentIsVisible = nodeData.type === ExpressionNodeType.LEAF;

    let valueToDisplay = nodeData.value;
    if (nodeData.type === ExpressionNodeType.LEAF) {
        valueToDisplay = nodeData.value.split('/')[1].split('-')[0];
    }

    const chooseThisNodeSubtree = useCallback(
        (event: React.MouseEvent<HTMLDivElement>) => {
            event.preventDefault();
            event.stopPropagation();
            console.log('alo');
            if (!choosable) {
                console.log('not choosable');
                return;
            }

            workingSchemaController?.selectSubtree(node.id);
        },
        [node, choosable]
    );

    const inspectThisNode = useCallback(() => {
        console.log('click!');
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
                    {valueToDisplay}
                    {accentIsVisible && <span className={block('value-accent')}>{' />'}</span>}
                </span>
            </div>
        </div>
    );
};
