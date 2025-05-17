import { Navigate } from 'react-router';

import { useWorkingSchemaContext } from '@features/WorkingSchemaContext/components/WorkingSchemaContext';
import { bem } from '@shared/bem';
import { InspectNodeSidebar } from '@widgets/InspectNodeSidebar';
import { TreeView } from '@widgets/TreeView';

import './EditPage.scss';

const block = bem('EditPage');

export const EditPage = () => {
    const { workingSchemaController: schemaController } = useWorkingSchemaContext();

    if (!schemaController) {
        return <Navigate to="/" />;
    }

    const selectMostProbableSchema = () => {
        schemaController.selectMostProbableTree();
    };

    const handleSchemaConfirmation = async () => {
        const finalSchema = schemaController.buildFinalSchema();
        const result = finalSchema.toJson();

        try {
            const response = await fetch('http://localhost:8000/schema/generatexsd/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(result),
            });

            if (!response.ok) {
                throw new Error('Failed to generate XSD');
            }

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `schema.xsd`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Error:', error);
        }
        // const jsonString = JSON.stringify(result, null, 4);
        // const blob = new Blob([jsonString], { type: 'application/json' });
        // const url = URL.createObjectURL(blob);
        // const link = document.createElement('a');
        // link.href = url;
        // link.download = 'data.json';
        // document.body.appendChild(link);
        // link.click();
        // document.body.removeChild(link);
        // URL.revokeObjectURL(url);
    };

    return (
        <div className={block()}>
            <div className={block('panel')}>
                <button
                    className="control"
                    onClick={selectMostProbableSchema}
                >
                    Выбрать наиболее вероятный вариант
                </button>
                <button
                    className="control"
                    onClick={handleSchemaConfirmation}
                >
                    Подтвердить
                </button>
            </div>
            <div className={block('workspace')}>
                <TreeView />
                <InspectNodeSidebar />
            </div>
        </div>
    );
};
