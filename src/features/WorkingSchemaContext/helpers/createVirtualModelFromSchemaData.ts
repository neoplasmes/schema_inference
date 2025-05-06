import { XSDType } from '@entities/node';
import {
    ExpressionNode,
    ExpressionNodeType,
    SchemaDataEntryBase,
    SchemaNode,
    SchemaNodeModel,
    VirtualSchemaModel,
} from '@model/treeModel';
import { assignObjectSkippingProperties } from '@shared/assignWithOmit';

import { createGlobalExpressionFromSchemaData } from './createGlobalExpressionFromSchemaData';

const expressionNodeValueRegexp =
    /^([a-zA-Z0-9_]+(\.)?[a-zA-Z0-9_]+)+-(s|c)\/([a-zA-Z0-9_]+(\.)?[a-zA-Z0-9_]+)+-(s|c)$/;

const getNameFromExpressionNodeValue = (expr: ExpressionNode): string => {
    if (expr.type !== ExpressionNodeType.LEAF) {
        return expr.value;
    }

    if (!expressionNodeValueRegexp.test(expr.value)) {
        new Error(`Unacceptable node value ${expr.value}`);
    }

    return expr.value.split('/')[1].split('-')[0];
};

/**
 * Метод, используемый для создания виртуальной модели дерева из JSON-ответа с сервера
 * @note При конвертации все AND < LEAF убираются, так как они не несут в себе никакой информации
 */
export const createVirtualModelFromSchemaData = <K extends SchemaDataEntryBase>(schemaData: Record<string, K>) => {
    const expressionRoot = createGlobalExpressionFromSchemaData(schemaData);

    const rootNodeData: SchemaNodeModel = assignObjectSkippingProperties(
        {
            chosen: false,
            chosenAttributes: [],
            chosenType: 'string',
            name: getNameFromExpressionNodeValue(expressionRoot),
        },
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
                {
                    chosen: false,
                    chosenAttributes: [],
                    chosenType: XSDType.PARENT,
                    name: getNameFromExpressionNodeValue(current.exprNode),
                },
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
