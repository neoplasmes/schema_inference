import React, { createContext, useContext, useState } from 'react';
import { SchemaDataEntry } from '../../model/treeModel';
import { WorkingSchemaController } from './model/WorkingSchemaController';
import { createVirtualModelFromSchemaData } from './helpers/createVirtualModelFromSchemaData';
import { WorkingSchemaWorkspace, WorkingSchemaWorkspaceData } from './model/WorkingSchemaWorkspace';

type WorkingSchemaContextType = {
    workingSchemaController: WorkingSchemaController | null;
    initialize: (schemaData: Record<string, SchemaDataEntry>) => void;
};

type WorkingSchemaContextProviderProps = React.PropsWithChildren<{}>;

const WorkingSchemaContext = createContext<WorkingSchemaContextType>({} as WorkingSchemaContextType);

export const useWorkingSchemaContext = () => {
    const context = useContext(WorkingSchemaContext);

    return context;
};

export const useSafelyWorkingSchemaController = () => {
    const { workingSchemaController } = useContext(WorkingSchemaContext);

    if (!workingSchemaController) {
        throw new Error('Attempt to use non-existing schemaController');
    }

    return workingSchemaController;
};

export const WorkingSchemaContextProvider = ({ children }: WorkingSchemaContextProviderProps) => {
    const [controller, setController] = useState<WorkingSchemaController | null>(null);

    const initialize = (schemaData: Record<string, SchemaDataEntry>) => {
        const virtualSchemaModel = createVirtualModelFromSchemaData(schemaData);

        const initialWorkspaceData: WorkingSchemaWorkspaceData = {
            inspectableNode: virtualSchemaModel.getRoot().id,
        };

        const newController = new WorkingSchemaController(
            virtualSchemaModel,
            schemaData,
            new WorkingSchemaWorkspace(initialWorkspaceData)
        );

        newController.selectMostProbableTree();

        setController(newController);
    };

    return (
        <WorkingSchemaContext.Provider value={{ workingSchemaController: controller, initialize }}>
            {children}
        </WorkingSchemaContext.Provider>
    );
};
