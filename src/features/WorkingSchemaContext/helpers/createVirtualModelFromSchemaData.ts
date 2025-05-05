import {
    ExpressionNode,
    ExpressionNodeType,
    SchemaDataEntryBase,
    SchemaNode,
    SchemaNodeModel,
    VirtualSchemaModel,
} from '../../../model/treeModel';
import { assignObjectSkippingProperties } from '../../../shared/assignWithOmit';
import { createGlobalExpressionFromSchemaData } from './createGlobalExpressionFromSchemaData';

// export const createVirtualModelFromSchemaData = <K extends SchemaDataEntryBase>(schemaData: Record<string, K>) => {
//     const expressionRoot = createGlobalExpressionFromSchemaData(schemaData);

//     const rootNodeData: SchemaNodeModel = assignObjectSkippingProperties(
//         { chosen: false, chosenAttributes: [], chosenType: 'string' },
//         expressionRoot,
//         ['children']
//     );

//     const schemaModel = new VirtualSchemaModel(rootNodeData);

//     const stack: { exprNode: ExpressionNode; schemaNodeParentId: number }[] = [];
//     // обработка слева направо. сразу запихиваем детей корня, т.к. его уже не надо обрабатывать
//     for (let i = expressionRoot.children.length - 1; i >= 0; i--) {
//         stack.push({
//             exprNode: expressionRoot.children[i],
//             schemaNodeParentId: schemaModel.getRoot().id,
//         });
//     }

//     while (stack.length > 0) {
//         const current = stack.pop()!;

//         const currentSchemaDataTransfer: SchemaNodeModel = assignObjectSkippingProperties(
//             { chosen: false, chosenAttributes: [], chosenType: 'string' },
//             current.exprNode,
//             ['children']
//         );

//         const addedNode = schemaModel.addNode(current.schemaNodeParentId, currentSchemaDataTransfer);

//         if (current.exprNode.children) {
//             for (let i = current.exprNode.children.length - 1; i >= 0; i--) {
//                 stack.push({
//                     exprNode: current.exprNode.children[i],
//                     schemaNodeParentId: addedNode.id,
//                 });
//             }
//         }
//     }

//     return schemaModel;
// };

export const createVirtualModelFromSchemaData = <K extends SchemaDataEntryBase>(schemaData: Record<string, K>) => {
    const expressionRoot = createGlobalExpressionFromSchemaData(schemaData);

    const rootNodeData: SchemaNodeModel = assignObjectSkippingProperties(
        { chosen: false, chosenAttributes: [], chosenType: 'string' },
        expressionRoot,
        ['children']
    );

    const schemaModel = new VirtualSchemaModel(rootNodeData);

    const stack: { exprNode: ExpressionNode; schemaNodeParent: SchemaNode<SchemaNodeModel> }[] = [];
    // обработка слева направо. сразу запихиваем детей корня, т.к. его уже не надо обрабатывать
    for (let i = expressionRoot.children.length - 1; i >= 0; i--) {
        stack.push({
            exprNode: expressionRoot.children[i],
            schemaNodeParent: schemaModel.getRoot(),
        });
    }

    while (stack.length > 0) {
        const current = stack.pop()!;

        let addedNode;
        if (
            !(
                current.exprNode.type == ExpressionNodeType.AND &&
                current.schemaNodeParent.getInternalData().type == ExpressionNodeType.LEAF
            )
        ) {
            const currentSchemaDataTransfer: SchemaNodeModel = assignObjectSkippingProperties(
                { chosen: false, chosenAttributes: [], chosenType: 'string' },
                current.exprNode,
                ['children']
            );

            addedNode = schemaModel.addNode(current.schemaNodeParent.id, currentSchemaDataTransfer);
        }

        if (current.exprNode.children) {
            for (let i = current.exprNode.children.length - 1; i >= 0; i--) {
                stack.push({
                    exprNode: current.exprNode.children[i],
                    schemaNodeParent: addedNode ? addedNode : current.schemaNodeParent,
                });
            }
        }
    }

    return schemaModel;
};
