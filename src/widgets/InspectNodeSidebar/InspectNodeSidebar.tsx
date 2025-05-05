import { useMemo } from 'react';

import { useSafelyWorkingSchemaController } from '@features/WorkingSchemaContext';
import { useReactiveState } from '@interfaces/Reactive/useReactiveState';
import { bem } from '@shared/bem/bem';

import { AttributesSpace } from './components/AttributesSpace/AttributesSpace';
import { NodeNameSpace } from './components/NodeNameSpace/NodeNameSpace';
import { XSDTypesSpace } from './components/XSDTypesSpace';
import './InspectNodeSidebar.scss';

const block = bem('InspectNodeSidebar');

export const InspectNodeSidebar = () => {
    const workingSchemaController = useSafelyWorkingSchemaController();

    const inspectableNode = useReactiveState(workingSchemaController.getWorkspace(), state => state.inspectableNode);

    const nodeNativeData = useMemo(() => {
        return workingSchemaController.getVirtualSchemaModel().getNodeById(inspectableNode);
    }, [inspectableNode]);

    const nodeExtraData = useMemo(() => {
        const inpectableNodeKey = workingSchemaController
            .getVirtualSchemaModel()
            .getNodeById(inspectableNode)
            .getInternalData().value;

        return workingSchemaController.getSchemaData()[inpectableNodeKey];
    }, [inspectableNode]);

    const nameToDisplay = nodeNativeData.getInternalData().value.split('/')[1].split('-')[0];

    return (
        <div className={block()}>
            <h3 className={block('header')}>
                Обзор тэга: <span>{nameToDisplay}</span>
            </h3>
            <div className={block('section')}>
                <NodeNameSpace
                    typos={nodeExtraData.typoSpace}
                    semantics={nodeExtraData.semanticSpace}
                />
            </div>
            <div className={block('section')}>
                <AttributesSpace node={nodeNativeData} />
            </div>
            <div className={block('section')}>
                <XSDTypesSpace node={nodeNativeData} />
            </div>
        </div>
    );
};
