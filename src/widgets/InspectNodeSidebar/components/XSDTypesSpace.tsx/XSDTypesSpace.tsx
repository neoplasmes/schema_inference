import { useMemo } from 'react';
import { useReactiveState } from '../../../../interfaces/Reactive/useReactiveState';
import { SchemaNode, SchemaNodeModel } from '../../../../model/treeModel';
import { useSafelyWorkingSchemaController } from '../../../../features/WorkingSchemaContext/WorkingSchemaContext';

import './XSDTypesSpace.scss';
import { assignObjectSkippingProperties } from '../../../../shared/assignWithOmit';

type XSDTypesSpaceProps = {
    node: SchemaNode<SchemaNodeModel>;
};

const typesFilterList = ['parent'];

export const XSDTypesSpace = ({ node }: XSDTypesSpaceProps) => {
    const chosenType = useReactiveState(node, state => state.chosenType);

    const schemaController = useSafelyWorkingSchemaController();

    const XSDTypesList = useMemo(() => {
        const nativeXSDTypes = schemaController.getSchemaData()[node.getInternalData().value].XSDTypes;

        return assignObjectSkippingProperties({}, nativeXSDTypes, typesFilterList);
    }, [node]);

    return <div>XSDTypesSpace</div>;
};
