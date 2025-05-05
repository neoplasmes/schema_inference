import { Reactive, ReactiveListenersTemplate } from '../../../interfaces/Reactive/Reactive';

export type WorkingSchemaWorkspaceData = {
    inspectableNode: number;
};

type Listener<T> = (value: T) => void;

/**
 * Класс для управления рабочей областью
 */
export class WorkingSchemaWorkspace
    extends ReactiveListenersTemplate<WorkingSchemaWorkspaceData>
    implements Reactive<WorkingSchemaWorkspaceData>
{
    private data: WorkingSchemaWorkspaceData;

    constructor(data: WorkingSchemaWorkspaceData) {
        super();

        this.data = data;
    }

    update(newData: Partial<WorkingSchemaWorkspaceData>): void {
        this.data = { ...this.data, ...newData };

        this.notify();
    }

    subscribe(listener: Listener<WorkingSchemaWorkspaceData>): () => void {
        return super.subscribe(listener);
    }

    getInternalData(): Readonly<WorkingSchemaWorkspaceData> {
        return this.data;
    }

    protected notify(): void {
        super.notify(this.data);
    }
}
