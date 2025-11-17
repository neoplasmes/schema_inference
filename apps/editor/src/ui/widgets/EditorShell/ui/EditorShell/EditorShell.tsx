import { useState } from 'react';
import type { EditorShellProps } from '../../model';
import { EditorToolbar } from '../EditorToolbar';
import { EditorNavigator } from '../EditorNavigator';
import { EditorInspector } from '../EditorInspector';
import { VariantComparison } from '../VariantComparison';
import { ViewportControls } from '../ViewportControls';
import styles from '../editorShell.module.css';

export function EditorShell(props: EditorShellProps): React.JSX.Element {
    const [mode, setMode] = useState(props.mode);
    const [search, setSearch] = useState('');
    const [notice, setNotice] = useState<string | null>(null);

    if (props.presentation === 'comparison') {
        return <VariantComparison {...props} notice={notice} setNotice={setNotice} />;
    }

    return (
        <div className={styles.shell}>
            <EditorToolbar
                {...props}
                mode={mode}
                setMode={setMode}
                search={search}
                setSearch={setSearch}
                setNotice={setNotice}
            />
            <EditorNavigator {...props} search={search} setNotice={setNotice} />
            <EditorInspector
                {...props}
                mode={mode}
                notice={notice}
                setNotice={setNotice}
            />
            <ViewportControls {...props} />
        </div>
    );
}
