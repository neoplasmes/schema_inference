import { useMemo } from 'react';

import { useSafelyWorkingSchemaController } from '@features/WorkingSchemaContext';
import { SchemaDataEntry, SchemaNode, SchemaNodeModel } from '@model/treeModel';
import { bem } from '@shared/bem';

import './NodeNameSpace.scss';

const block = bem('NodeNameSpace');

type NodeNameSpaceProps = {
    node: SchemaNode<SchemaNodeModel>;
};

const NamePercentageItem = ({ name, percentage }: { name: string; percentage: number }) => {
    const percentageDisplay = (percentage * 100).toFixed(0) + '%';
    return (
        <div className={block('item')}>
            <span className="name">{name}</span>
            <span className="probability">{percentageDisplay}</span>
        </div>
    );
};

export const NodeNameSpace = ({ node }: NodeNameSpaceProps) => {
    const schemaController = useSafelyWorkingSchemaController();

    const content = useMemo(() => {
        const nodeData = schemaController.getSchemaData()[node.getInternalData().value];

        const sortedTypos = Object.entries(nodeData.typoSpace).sort(([_, probA], [__, probB]) => probB - probA);

        let typosContent;
        if (sortedTypos.length === 0) {
            typosContent = <span className="no-data">нет информации</span>;
        } else {
            typosContent = (
                <ul>
                    {sortedTypos.map(([name, probability]) => (
                        <li key={name}>
                            <div className={block('item')}>
                                <span className="name">{name}</span>
                                <span className="probability">{(probability * 100).toFixed(0) + '%'}</span>
                            </div>
                        </li>
                    ))}
                </ul>
            );
        }

        const sortedSemantics = Object.entries(nodeData.semanticSpace).sort(([_, probA], [__, probB]) => probB - probA);

        let semanticsContent;
        if (sortedSemantics.length === 0) {
            semanticsContent = <span className="no-data">нет информации</span>;
        } else {
            semanticsContent = (
                <ul>
                    {sortedSemantics.map(([name, probability]) => (
                        <li key={name}>
                            <div className={block('item')}>
                                <span className="name">{name}</span>
                                <span className="probability">{(probability * 100).toFixed(0) + '%'}</span>
                            </div>
                        </li>
                    ))}
                </ul>
            );
        }

        return {
            typosContent,
            semanticsContent,
        };
    }, [node]);

    return (
        <div className={block()}>
            <div className={block('section')}>
                <h4>Опечатки</h4>
                {content.typosContent}
            </div>
            <div className={block('section')}>
                <h4>Альтернативные названия</h4>
                {content.semanticsContent}
            </div>
        </div>
    );
};
