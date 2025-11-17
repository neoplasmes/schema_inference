import type { ComponentType } from 'react';
import type { EditorProps } from '../ui/pages/editor';
import styles from './standalone.module.css';

export default function StandaloneEditor({
    Editor,
}: {
    Editor: ComponentType<EditorProps>;
}): React.JSX.Element {
    return (
        <div className={styles.standalone}>
            <Editor
                resource={{
                    kind: 'schema',
                    schemaId: 'standalone-fixture',
                    revision: 'fixture-1',
                }}
                apiBaseUrl="fixture://standalone"
            />
        </div>
    );
}
