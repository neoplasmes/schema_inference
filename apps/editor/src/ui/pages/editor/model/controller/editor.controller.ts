import type { PlaygroundScene } from '../../../../../../playground';
import { useDependencies } from '../../../../di';
import { useEditorIntents } from '../intents';
import type { EditorProps } from '../resource';
import { useEditorSave } from '../save';
import { useEditorSession } from '../session';

export function useEditorController(props: EditorProps, scene: PlaygroundScene) {
    const createDependencies = useDependencies();
    const state = useEditorSession(props, scene, createDependencies);
    const { activeSession, version, error, demo } = state;
    const intents = useEditorIntents(state);
    const { save } = useEditorSave(props, state);

    return {
        projection: {
            session: activeSession,
            version,
            error,
            demo,
        },
        ...intents,
        demo,
        session: activeSession,
        message: state.message,
        error,
        busy: state.busy,
        saveBlocked: state.saveBlocked,
        resourceKey: `${state.resourceKey}/${state.retry}`,
        title: activeSession?.document.manifest.title ?? 'Schema editor',
        canUndo: activeSession?.document.canUndo ?? false,
        canRedo: activeSession?.document.canRedo ?? false,
        pendingChanges: activeSession?.document.operations.length ?? 0,
        save,
        retry: () => state.setRetry(value => value + 1),
    };
}

export type EditorController = ReturnType<typeof useEditorController>;
