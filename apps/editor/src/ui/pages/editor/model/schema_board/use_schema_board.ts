import { useEffect, useRef, useState } from 'react';
import {
    createSchemaBoard,
    type BoardEventMap,
    type BoardModel,
    type BoardViewport,
    type SchemaBoard,
} from '../../../../../board';

export type BoardHandlers = {
    [K in keyof BoardEventMap]?: (event: BoardEventMap[K]) => void;
};

export function useSchemaBoard(
    model: BoardModel,
    camera: BoardViewport,
    handlers: BoardHandlers,
    identity: string,
    background = true
) {
    const container = useRef<HTMLDivElement>(null);
    const board = useRef<SchemaBoard | null>(null);
    const latestModel = useRef(model);
    const latestHandlers = useRef(handlers);
    const initialCamera = useRef(camera);
    const [ready, setReady] = useState(false);
    const [error, setError] = useState<string | null>(null);
    latestModel.current = model;
    latestHandlers.current = handlers;
    initialCamera.current = camera;

    useEffect(() => {
        const element = container.current;

        if (!element) {
            return;
        }

        let disposed = false;
        setReady(false);
        setError(null);
        const instance = createSchemaBoard({
            container: element,
            model: latestModel.current,
            viewport: initialCamera.current,
            background,
        });
        board.current = instance;
        const subscriptions = (
            Object.keys(latestHandlers.current) as (keyof BoardEventMap)[]
        ).map(name =>
            instance.on(name, event => {
                const handler = latestHandlers.current[name] as
                    | ((payload: typeof event) => void)
                    | undefined;
                handler?.(event);
            })
        );

        void Promise.all([instance.ready, document.fonts.ready])
            .then(() => {
                if (disposed) {
                    return;
                }

                instance.setModel(latestModel.current);
                requestAnimationFrame(() =>
                    requestAnimationFrame(() => {
                        if (!disposed) {
                            setReady(true);
                        }
                    })
                );
            })
            .catch((reason: unknown) => {
                if (!disposed) {
                    setError(
                        reason instanceof Error
                            ? reason.message
                            : 'The canvas could not start.'
                    );
                }
            });

        return () => {
            disposed = true;
            subscriptions.forEach(unsubscribe => unsubscribe());
            instance.destroy();

            if (board.current === instance) {
                board.current = null;
            }
        };
    }, [identity, background]);

    useEffect(() => {
        board.current?.setModel(model);
    }, [model]);

    return { container, board, ready, error };
}
