import { useMemo } from 'react';

import { XSDType } from '@entities/node';
import { useSafelyWorkingSchemaController } from '@features/WorkingSchemaContext';
import { useReactiveState } from '@interfaces/Reactive/useReactiveState';
import { SchemaNode, SchemaNodeModel } from '@model/treeModel';
import { assignObjectSkippingProperties } from '@shared/assignWithOmit';
import { bem } from '@shared/bem';

import './XSDTypesSpace.scss';

const block = bem('XSDTypesSpace');

type XSDTypesSpaceProps = {
    node: SchemaNode<SchemaNodeModel>;
};

type NormalizedXSDTypesData = {
    name: XSDType;
    probability: number;
};

const typesFilterList = [XSDType.PARENT, XSDType.EMPTY];

export const XSDTypesSpace = ({ node }: XSDTypesSpaceProps) => {
    const schemaController = useSafelyWorkingSchemaController();
    const chosenType = useReactiveState(node, state => state.chosenType);

    const XSDTypesList = useMemo(() => {
        const nativeXSDTypes = schemaController.getSchemaData()[node.getInternalData().value].XSDTypes;

        const result: Array<NormalizedXSDTypesData> = [];
        Object.entries(nativeXSDTypes).forEach(([name, probability]) => {
            if (!typesFilterList.includes(name as XSDType)) {
                result.push({
                    name: name as XSDType,
                    probability,
                });
            }
        });

        return result;
    }, [node]);

    const onXSDTypeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        node.update({ chosenType: event.target.value });
    };

    let content;
    if (!XSDTypesList.length) {
        content = <span className="no-data">нет информации</span>;
    } else {
        content = XSDTypesList.map(data => (
            <li key={data.name}>
                <div className="item">
                    <div className={block('checkbox-group')}>
                        <input
                            className={block('radio')}
                            id={`${block()}-radio-${data.name}`}
                            type="radio"
                            name={`${block()}-radio`}
                            value={data.name}
                            checked={data.name === chosenType}
                            onChange={onXSDTypeChange}
                        />
                        <label
                            className={block('name')}
                            htmlFor={`${block()}-radio-${data.name}`}
                        >
                            {data.name}
                        </label>
                    </div>
                    <span className="probability">{(data.probability * 100).toFixed(0) + '%'}</span>
                </div>
            </li>
        ));
    }

    return (
        <div className={block()}>
            <h4>Вероятные типы данных</h4>
            <ul>{content}</ul>
        </div>
    );
};
