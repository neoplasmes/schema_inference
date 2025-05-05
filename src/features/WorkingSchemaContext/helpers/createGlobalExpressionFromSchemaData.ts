import { ExpressionNode, ExpressionNodeType, SchemaDataEntryBase } from '../../../model/treeModel';

/**
 * Это надо оптимизировать 100%
 * @param schemaData
 * @returns
 */
export const createGlobalExpressionFromSchemaData = <K extends SchemaDataEntryBase>(schemaData: Record<string, K>) => {
    const datacopy: Record<string, K> = JSON.parse(JSON.stringify(schemaData));

    const aaa = (node: ExpressionNode, parent: string) => {
        if (node.type === ExpressionNodeType.LEAF) {
            const nodeKey = `${parent}/${node.value}`;
            // console.log(nodeKey);
            if (!datacopy[nodeKey]) {
                return;
            }

            node.children.push(datacopy[nodeKey].expression);
            parent = node.value;
            node.value = nodeKey;
        }

        if (node.children) {
            for (const child of node.children) {
                aaa(child, parent);
            }
        }
    };

    const startPoint = datacopy['begin-c/root-c'];
    if (!startPoint) {
        throw new Error('invalid schema data');
    }

    for (const child of [startPoint.expression]) {
        aaa(child, 'root-c');
    }

    const normalizedRoot: ExpressionNode = {
        type: ExpressionNodeType.LEAF,
        minOccurs: 1,
        maxOccurs: 1,
        probability: 1,
        value: 'begin-c/root-c',
        children: [startPoint.expression],
    };

    return normalizedRoot;
};
