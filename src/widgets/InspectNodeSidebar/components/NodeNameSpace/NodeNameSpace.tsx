import { SchemaDataEntry } from '../../../../model/treeModel';
import { bem } from '../../../../shared/bem';
import './NodeNameSpace.scss';

const block = bem('NodeNameSpace');

type NodeNameSpaceProps = {
    typos: SchemaDataEntry['typoSpace'];
    semantics: SchemaDataEntry['semanticSpace'];
};

const NamePercentageItem = ({ name, percentage }: { name: string; percentage: number }) => {
    const percentageDisplay = (percentage * 100).toFixed(2) + '%';
    return (
        <div className={block('item')}>
            <span className="name">{name}</span>
            <span className="percentage">{percentageDisplay}</span>
        </div>
    );
};

export const NodeNameSpace = ({ typos, semantics }: NodeNameSpaceProps) => {
    const sortedTypos = Object.entries(typos).sort((a, b) => b[1] - a[1]);
    const sortedSemantics = Object.entries(semantics).sort((a, b) => b[1] - a[1]);

    return (
        <div className={block()}>
            <div className={block('section')}>
                <h4>Опечатки</h4>
                <ul>
                    {sortedTypos.map(([name, percentage]) => (
                        <li key={name}>
                            <NamePercentageItem
                                name={name}
                                percentage={percentage}
                            />
                        </li>
                    ))}
                </ul>
            </div>
            <div className={block('section')}>
                <h4>Альтернативные названия</h4>
                <ul>
                    {sortedSemantics.map(([name, percentage]) => (
                        <li key={name}>
                            <NamePercentageItem
                                name={name}
                                percentage={percentage}
                            />
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
};
