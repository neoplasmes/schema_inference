import { ExpressionNode, SchemaDataEntryBase, SchemaNodeModel, VirtualSchemaModel } from '../../../model/treeModel';
import { assignObjectSkippingProperties } from '../../../shared/assignWithOmit';
import { createGlobalExpressionFromSchemaData } from './createGlobalExpressionFromSchemaData';

export const createVirtualModelFromSchemaData = <K extends SchemaDataEntryBase>(schemaData: Record<string, K>) => {
    const expressionRoot = createGlobalExpressionFromSchemaData(schemaData);

    const rootNodeData: SchemaNodeModel = assignObjectSkippingProperties(
        { chosen: false, chosenAttributes: [], chosenType: 'string' },
        expressionRoot,
        ['children']
    );

    const schemaModel = new VirtualSchemaModel(rootNodeData);

    const stack: { exprNode: ExpressionNode; schemaNodeParentId: number }[] = [];
    // обработка слева направо. сразу запихиваем детей корня, т.к. его уже не надо обрабатывать
    for (let i = expressionRoot.children.length - 1; i >= 0; i--) {
        stack.push({
            exprNode: expressionRoot.children[i],
            schemaNodeParentId: schemaModel.getRoot().id,
        });
    }

    while (stack.length > 0) {
        const current = stack.pop()!;

        const currentSchemaDataTransfer: SchemaNodeModel = assignObjectSkippingProperties(
            { chosen: false, chosenAttributes: [], chosenType: 'string' },
            current.exprNode,
            ['children']
        );

        const addedNode = schemaModel.addNode(current.schemaNodeParentId, currentSchemaDataTransfer);

        if (current.exprNode.children) {
            for (let i = current.exprNode.children.length - 1; i >= 0; i--) {
                stack.push({
                    exprNode: current.exprNode.children[i],
                    schemaNodeParentId: addedNode.id,
                });
            }
        }
    }

    return schemaModel;
};
