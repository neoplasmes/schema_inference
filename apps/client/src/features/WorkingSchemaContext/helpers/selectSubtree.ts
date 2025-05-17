import { ExpressionNodeType, SchemaDataEntry, SchemaNode, SchemaNodeModel, VirtualSchemaModel } from '@model/treeModel';

import { selectMostProbableSubtrees } from './selectMostProbableSubtrees';

const updateSubtreeSelection = (
    choosedNode: SchemaNode<SchemaNodeModel>,
    schemaData: Record<string, SchemaDataEntry>,
    value: boolean
) => {
    const stack = [choosedNode];

    while (stack.length) {
        const current = stack.pop();

        if (!current) {
            return;
        }

        current.update({ chosen: value });
        const currentData = current.getInternalData();
        if (currentData.type === ExpressionNodeType.OR && currentData.chosen) {
            selectMostProbableSubtrees(current, schemaData);
        } else {
            for (let i = current.children.length - 1; i >= 0; i--) {
                stack.push(current.children[i]);
            }
        }
    }
};

/**
 * Идём от указанной node к корню дерева, собирая все OR-узлы.
 * Затем для каждого ребёнка OR узла применяем updateSubtreeSelection
 * @param model
 * @param schemaData
 * @param nodeID
 */
export const selectSubtree = (
    model: VirtualSchemaModel<SchemaNodeModel>,
    schemaData: Record<string, SchemaDataEntry>,
    nodeID: number
) => {
    const subtreePath: Array<{ orNode: SchemaNode<SchemaNodeModel>; choosedNode: SchemaNode<SchemaNodeModel> }> = [];
    let current = model.getNodeById(nodeID);
    while (current !== model.getRoot()) {
        //console.log(current.data.value);
        const parent = model.getNodeParent(current.id);

        if (!parent) {
            throw new Error('impossible');
        }
        const parentData = parent.getInternalData();
        if (parentData.type === ExpressionNodeType.OR) {
            subtreePath.push({
                orNode: parent,
                choosedNode: current,
            });
        }

        current = parent;
    }

    for (const { orNode, choosedNode } of subtreePath.reverse()) {
        for (const child of orNode.children) {
            //console.log(child.data.value, choosedNode.data.value);
            updateSubtreeSelection(child, schemaData, child === choosedNode);
        }
    }
};
