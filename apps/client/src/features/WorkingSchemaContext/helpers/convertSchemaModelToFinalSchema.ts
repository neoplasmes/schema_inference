import { XSDType } from '@entities/node';
import { ExpressionNodeType, SchemaDataEntry, SchemaNode, SchemaNodeModel, VirtualSchemaModel } from '@model/treeModel';
import { assignObjectSkippingProperties } from '@shared/assignWithOmit/assignWithOmit';

export type FinalSchemaNodeModel = Pick<SchemaNodeModel, 'type' | 'name' | 'minOccurs' | 'maxOccurs'> & {
    /**
     * список атрибутов
     * key: имя - value: тип
     */
    attributes: Record<string, string>;
    /**
     * Выбранный тип данных
     */
    chosenType: string;
};

const convertAttributes = (
    oldAttributes: SchemaDataEntry['attributes'],
    chosenAttributes: string[]
): FinalSchemaNodeModel['attributes'] => {
    const result: FinalSchemaNodeModel['attributes'] = {};

    for (const attrName of chosenAttributes) {
        let bestType: string = 'string';
        let bestProb = -Infinity;

        Object.entries(oldAttributes[attrName].XSDTypes).forEach(([xsdtype, prob]) => {
            if (prob > bestProb) {
                bestProb = prob;
                bestType = xsdtype;
            }
        });

        result[attrName] = bestType;
    }

    return result;
};

/**
 * @note свойства chosenType и name просто переносится внутри метода assignObjectSkippingProperties.
 * @param model
 * @param schemaData
 * @returns
 */
export const convertSchemaModelToFinalSchema = (
    model: VirtualSchemaModel<SchemaNodeModel>,
    schemaData: Record<string, SchemaDataEntry>
): VirtualSchemaModel<FinalSchemaNodeModel> => {
    const oldRootData = model.getRoot().getInternalData();
    const finalRootAttributes = convertAttributes(
        schemaData[oldRootData.value].attributes,
        oldRootData.chosenAttributes
    );
    const finalRootNewData: FinalSchemaNodeModel = assignObjectSkippingProperties(
        {},
        { ...oldRootData, attributes: finalRootAttributes },
        ['chosen', 'probability', 'chosenAttributes', 'value']
    );

    const result = new VirtualSchemaModel<FinalSchemaNodeModel>(finalRootNewData);

    const stack: Array<{ oldNode: SchemaNode<SchemaNodeModel>; finalParent: SchemaNode<FinalSchemaNodeModel> }> = model
        .getRoot()
        .children.map(child => ({
            oldNode: child,
            finalParent: result.getRoot(),
        }));

    while (stack.length) {
        const { oldNode, finalParent } = stack.pop()!;

        const oldNodeData = oldNode.getInternalData();
        if (!oldNodeData.chosen) {
            continue;
        }

        let newNode;
        if (oldNodeData.type === ExpressionNodeType.LEAF) {
            const oldDataCopy = { ...oldNodeData };

            oldDataCopy.value = oldDataCopy.value.split('/')[1].split('-')[0];

            const attributes = convertAttributes(
                schemaData[oldNodeData.value].attributes,
                oldNodeData.chosenAttributes
            );

            newNode = result.addNode(
                finalParent.id,
                assignObjectSkippingProperties({}, Object.assign(oldDataCopy, { attributes }), [
                    'chosen',
                    'probability',
                    'chosenAttributes',
                    'value',
                ])
            );
        }

        for (const child of oldNode.children) {
            const childData = child.getInternalData();

            if (childData.chosen) {
                stack.push({
                    oldNode: child,
                    finalParent: newNode ?? finalParent,
                });
            }
        }
    }

    return result;
};
