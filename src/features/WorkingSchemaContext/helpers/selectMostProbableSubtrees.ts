import { ExpressionNodeType, SchemaDataEntry, SchemaNode, SchemaNodeModel } from '../../../model/treeModel';

export const selectMostProbableSubtrees = (
    startNode: SchemaNode<SchemaNodeModel>,
    schemaData: Record<string, SchemaDataEntry>,
    attributesThreshold = 0.55
) => {
    const stack: { node: SchemaNode<SchemaNodeModel>; chosen: boolean }[] = [{ node: startNode, chosen: true }];

    while (stack.length > 0) {
        const { node, chosen } = stack.pop()!; // Берем узел из стека

        node.update({ chosen });

        let selectedChild: SchemaNode<SchemaNodeModel> | null = null;
        // Проверяем, является ли узел типа OR
        const nodeData = node.getInternalData();
        if (nodeData.type === ExpressionNodeType.OR && chosen) {
            let maxProbability = -Infinity;

            // Находим дочерний узел с максимальной вероятностью
            for (const child of node.children) {
                const childData = child.getInternalData();
                if (childData.probability > maxProbability) {
                    maxProbability = childData.probability;
                    selectedChild = child;
                }
            }
        }

        if (node.getInternalData().type === ExpressionNodeType.LEAF) {
            //Выбираем наиболее вероятные атрибуты для листьев
            const nodeValue = node.getInternalData().value;
            const attributes = schemaData[nodeValue].attributes;

            const chosenAttributes = [];
            for (const [name, data] of Object.entries(attributes)) {
                if (data.probability >= attributesThreshold) {
                    chosenAttributes.push(name);
                }
            }

            node.update({ chosenAttributes });
        }

        // Добавляем дочерние узлы в стек (в обратном порядке, чтобы сохранить порядок обхода)
        for (let i = node.children.length - 1; i >= 0; i--) {
            const childNodeData = {
                node: node.children[i],
                chosen: selectedChild ? node.children[i] === selectedChild : chosen,
            };

            stack.push(childNodeData);
        }
    }
};
