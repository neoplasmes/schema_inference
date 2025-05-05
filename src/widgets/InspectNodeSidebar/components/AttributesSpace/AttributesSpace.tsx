import { useWorkingSchemaContext } from '../../../../features/WorkingSchemaContext/WorkingSchemaContext';
import { useCallback, useMemo } from 'react';
import { bem } from '../../../../shared/bem';
import { SchemaNode, SchemaNodeModel } from '../../../../model/treeModel';
import { useReactiveState } from '../../../../interfaces/Reactive/useReactiveState';

import './AttributesSpace.scss';

const block = bem('AttributesSpace');

type AttributesSpaceProps = {
    node: SchemaNode<SchemaNodeModel>;
};

type NormalizedAttributeData = {
    name: string;
    probability: number;
    XSDTypes: string;
};

export const AttributesSpace = ({ node }: AttributesSpaceProps) => {
    const chosenAttributes = useReactiveState(node, state => state.chosenAttributes);

    const { workingSchemaController } = useWorkingSchemaContext();

    if (!workingSchemaController) {
        throw new Error('controller unprovided');
    }

    const attributesList = useMemo(() => {
        const key = node.getInternalData().value;

        const pureAttributesList = workingSchemaController.getSchemaData()[key].attributes;

        const attributesNamesSorted = Object.keys(pureAttributesList).sort((a, b) => {
            return a.localeCompare(b);
        });

        const result: NormalizedAttributeData[] = [];

        for (const name of attributesNamesSorted) {
            let bestProb = -1;
            let bestType = '';

            Object.entries(pureAttributesList[name].XSDTypes).forEach(([xsdtype, prob]) => {
                if (prob > bestProb) {
                    bestProb = prob;
                    bestType = xsdtype;
                }
            });

            result.push({
                name: name,
                probability: pureAttributesList[name].probability,
                XSDTypes: bestType,
            });
        }

        result.sort((a, b) => b.probability - a.probability);

        return result;
    }, [node]);

    const onAttributeChoose = useCallback(
        (event: React.ChangeEvent<HTMLInputElement>) => {
            const attrName = event.target.value;
            const chosen = event.target.checked;

            console.log(attrName, chosen);

            let newChosenAttributes = [];
            if (chosen) {
                const temp = new Set(chosenAttributes);
                temp.add(attrName);
                newChosenAttributes = Array.from(temp);
            } else {
                const temp = new Set(chosenAttributes);
                temp.delete(attrName);
                newChosenAttributes = Array.from(temp);
            }

            node.update({
                chosenAttributes: newChosenAttributes,
            });
        },
        [node]
    );

    return (
        <div className={block()}>
            <h4>Аттрибуты</h4>
            <ul>
                {attributesList.map(attr => {
                    return (
                        <li key={attr.name}>
                            <div className={block('item')}>
                                <div className={block('checkbox-group')}>
                                    <input
                                        type="checkbox"
                                        id={`checkbox-${attr.name}`}
                                        checked={chosenAttributes.includes(attr.name)}
                                        onChange={onAttributeChoose}
                                        value={attr.name}
                                    />
                                    <label
                                        className={block('name')}
                                        htmlFor={`checkbox-${attr.name}`}
                                    >
                                        {attr.name}
                                    </label>
                                </div>
                                <span className={block('type')}>{attr.XSDTypes}</span>
                                <span className={block('probability')}>
                                    {(attr.probability * 100).toFixed(2) + '%'}
                                </span>
                            </div>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
};
