import { useMemo, useRef, useState } from 'react';

import { useSafelyWorkingSchemaController } from '@features/WorkingSchemaContext';
import { useReactiveState } from '@interfaces/Reactive/useReactiveState';
import { bem } from '@shared/bem/bem';

import { AttributesSpace } from './components/AttributesSpace/AttributesSpace';
import { NodeNameSpace } from './components/NodeNameSpace/NodeNameSpace';
import { XSDTypesSpace } from './components/XSDTypesSpace';
import './InspectNodeSidebar.scss';

const block = bem('InspectNodeSidebar');

export const InspectNodeSidebar = () => {
    const [inputIsFocused, setInputIsFocused] = useState<boolean>(false);
    const [focusedInputValue, setFocusedInputValue] = useState<string>('');

    const workingSchemaController = useSafelyWorkingSchemaController();

    const inspectableNode = useReactiveState(workingSchemaController.getWorkspace(), state => state.inspectableNode);
    const nodeInstance = useMemo(() => {
        return workingSchemaController.getVirtualSchemaModel().getNodeById(inspectableNode);
    }, [inspectableNode]);

    const nodeName = useReactiveState(nodeInstance, state => state.name);

    const onInputFocus = () => {
        setFocusedInputValue(nodeName);
        setInputIsFocused(true);
    };

    const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFocusedInputValue(e.target.value);
    };

    const onInputBlur = () => {
        nodeInstance.update({ name: focusedInputValue });
        setInputIsFocused(false);
    };

    return (
        <div className={block()}>
            <h3 className={block('header')}>
                <span>Обзор тэга: </span>
                <input
                    value={inputIsFocused ? focusedInputValue : nodeName}
                    onChange={onInputChange}
                    onFocus={onInputFocus}
                    onBlur={onInputBlur}
                />
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-5 w-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                >
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                    />
                </svg>
            </h3>
            <div className={block('section')}>
                <NodeNameSpace node={nodeInstance} />
            </div>
            <div className={block('section')}>
                <AttributesSpace node={nodeInstance} />
            </div>
            <div className={block('section')}>
                <XSDTypesSpace node={nodeInstance} />
            </div>
        </div>
    );
};

/**
 * <button
                onClick={() => setIsEditing(true)}
                className="p-2 text-gray-500 hover:text-gray-700"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                  />
                </svg>
              </button>
 */
