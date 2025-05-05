import { useWorkingSchemaContext } from '../../features/WorkingSchemaContext/components/WorkingSchemaContext';
import { bem } from '../../shared/bem/bem';
import { TreeView } from '../../widgets/TreeView/TreeView';
import './EditPage.scss';

const block = bem('EditPage');

export const EditPage = () => {
    const ctx = useWorkingSchemaContext();

    return (
        <div className={block()}>
            <TreeView />
        </div>
    );
};
