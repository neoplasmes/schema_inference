import { ExpressionNodeType, SchemaDataEntry, SchemaNodeModel, VirtualSchemaModel } from '../../../model/treeModel';
import { selectSubtree as selectSubtreeBase } from '../helpers/selectSubtree';
import { selectMostProbableSubtrees } from '../helpers/selectMostProbableSubtrees';
import { convertSchemaModelToFinalSchema, FinalSchemaNodeModel } from '../helpers/convertSchemaModelToFinalSchema';
import { WorkingSchemaWorkspaceData } from './WorkingSchemaWorkspace';
import { Reactive } from '../../../interfaces/Reactive/Reactive';

export class WorkingSchemaController {
    private virtualSchemaModel: VirtualSchemaModel<SchemaNodeModel>;
    private schemaData: Record<string, SchemaDataEntry>;
    private workingSchemaWorkspace: Reactive<WorkingSchemaWorkspaceData>;

    constructor(
        virtualSchemaModel: VirtualSchemaModel<SchemaNodeModel>,
        schemaData: Record<string, SchemaDataEntry>,
        workingSchemaWorkspace: Reactive<WorkingSchemaWorkspaceData>
    ) {
        this.virtualSchemaModel = virtualSchemaModel;
        this.schemaData = schemaData;
        this.workingSchemaWorkspace = workingSchemaWorkspace;
    }

    getSchemaData(): Record<string, SchemaDataEntry> {
        return this.schemaData;
    }

    getVirtualSchemaModel(): VirtualSchemaModel<SchemaNodeModel> {
        return this.virtualSchemaModel;
    }

    getWorkspace(): Reactive<WorkingSchemaWorkspaceData> {
        return this.workingSchemaWorkspace;
    }

    buildFinalSchema(): VirtualSchemaModel<FinalSchemaNodeModel> {
        return convertSchemaModelToFinalSchema(this.virtualSchemaModel, this.schemaData);
    }

    selectSubtree(nodeID: number): void {
        selectSubtreeBase(this.virtualSchemaModel, this.schemaData, nodeID);
    }

    selectMostProbableTree(): void {
        selectMostProbableSubtrees(this.virtualSchemaModel.getRoot(), this.schemaData);
    }

    setInspectableNode(nodeID: number): void {
        const candidateToInspect = this.virtualSchemaModel.getNodeById(nodeID);

        if (candidateToInspect.getInternalData().type !== ExpressionNodeType.LEAF) {
            return;
        }

        this.workingSchemaWorkspace.update({ inspectableNode: nodeID });
    }
}
