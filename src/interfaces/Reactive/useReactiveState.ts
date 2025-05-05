import { useEffect, useRef, useState } from 'react';
import { Reactive } from './Reactive';

type StateExtractor<T, State> = (state: T) => State;

export const useReactiveState = <T, State>(model: Reactive<T>, extractor: StateExtractor<T, State>) => {
    const [state, setState] = useState<State>(() => extractor(model.getInternalData()));
    // Если это не сделать, то когда в одном и том же компоненте, в одном и том же хуке меняется модель
    // у нас не переключится стейт на данные из новой модели.
    // Переключать стейт на новый данный через useEffect я считаю небезопасным, т.к. в таком случае мы бы меняли стейт после
    // рендера компонента и вызывали бы повторный рендер.
    // К тому же, неизвестно, как это будет конфликтовать с эффектом на sub/unsub
    const prevModel = useRef<Reactive<T>>(model);

    if (model != prevModel.current) {
        setState(extractor(model.getInternalData()));
        prevModel.current = model;
    }

    useEffect(() => {
        const unsubscrive = model.subscribe(data => {
            const newState = extractor(data);

            setState(prev => (shallowEqual(prev, newState) ? prev : newState));
        });

        return () => unsubscrive();
    }, [model, extractor]);

    return state;
};

function shallowEqual<T>(a: T, b: T): boolean {
    // Handle strict equality for primitives and same reference
    if (a === b) {
        return true;
    }

    // Handle null and undefined cases
    if (a == null || b == null) {
        return false;
    }

    // Handle arrays
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) {
            return false;
        }
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) {
                return false;
            }
        }
        return true;
    }

    // Handle objects (excluding arrays, null, and other special objects)
    if (typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
        const keysA = Object.keys(a) as (keyof T)[];
        const keysB = Object.keys(b) as (keyof T)[];

        if (keysA.length !== keysB.length) {
            return false;
        }

        for (const key of keysA) {
            if (!keysB.includes(key) || a[key] !== b[key]) {
                return false;
            }
        }
        return true;
    }

    // If types don't match or we have other non-primitive types
    return false;
}
