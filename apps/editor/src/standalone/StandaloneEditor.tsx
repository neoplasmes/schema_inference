import Editor from '../expose/Editor';
import styles from '../app/EditorApplication.module.css';

export default function StandaloneEditor(): React.JSX.Element {
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
