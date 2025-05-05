import { useCallback, useRef, useState } from 'react';

import { Navigate } from 'react-router';

import { useWorkingSchemaContext } from '../../features/WorkingSchemaContext/components/WorkingSchemaContext';
import { ExpressionNode } from '../../model/treeModel';
import { bem } from '../../shared/bem/bem';
import { InspectNodeSidebar } from '../InspectNodeSidebar/InspectNodeSidebar';
import { TreeNode } from './components/TreeNode/TreeNode';
import './TreeView.scss';

const block = bem('TreeView');

type TreeViewProps = {
    data: ExpressionNode;
};

export type Position = {
    left: number;
    top: number;
};

const initialTreeContentOffset: Position = {
    top: 0,
    left: 0,
};

export const TreeView = () => {
    const [zoom, setZoom] = useState(1); // Начальный масштаб 100%
    const [treeContentOffset, setTreeContentOffset] = useState<Position>(initialTreeContentOffset);
    const [isDragging, setIsDragging] = useState<boolean>(false);

    const dragStartRef = useRef<Position>(initialTreeContentOffset); // Начальная позиция мыши
    const treeOffsetOnDragStart = useRef<Position>(initialTreeContentOffset);
    const rootNodeRef = useRef<HTMLDivElement>(null);

    const { workingSchemaController } = useWorkingSchemaContext();

    // Обработчик события onWheel
    const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
        // Проверяем, что зажата клавиша Alt
        if (event.altKey) {
            event.preventDefault(); // Предотвращаем стандартное поведение
            event.stopPropagation();
            const zoomStep = 0.05; // Шаг изменения масштаба (10%)
            const delta = event.deltaY > 0 ? -zoomStep : zoomStep; // Вниз = уменьшить, вверх = увеличить

            setZoom(prevZoom => {
                const newZoom = Math.min(Math.max(prevZoom + delta, 0.1), 1);
                return newZoom;
            });
        } else if (!isDragging) {
            event.stopPropagation();
            // Нормализация deltaY и учет масштаба
            const scrollSpeed = 1 / zoom; // Увеличиваем перемещение при уменьшении масштаба
            const deltaY = (event.deltaY * scrollSpeed) / 2; // Вертикальное перемещение
            setTreeContentOffset(prevOffset => ({
                top: prevOffset.top - deltaY, // Инвертируем, чтобы скролл вниз перемещал вверх
                left: prevOffset.left,
            }));
        }
    }, []);

    const handleMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
        // Проверяем, что это левая кнопка мыши
        if (event.button !== 0 || !rootNodeRef.current) {
            return;
        }

        const treeNodeBodyClassName = rootNodeRef.current.className;
        const isTreeNode = (event.target as HTMLElement).closest(`.${treeNodeBodyClassName}`);
        if (isTreeNode) {
            return;
        }

        setIsDragging(true);
        dragStartRef.current = {
            top: event.clientY,
            left: event.clientX,
        };
        treeOffsetOnDragStart.current = treeContentOffset;
    };

    // Перемещение мыши
    const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
        if (isDragging) {
            // Учитываем масштаб при расчете смещения
            const deltaX = event.clientX - dragStartRef.current.left;
            const deltaY = event.clientY - dragStartRef.current.top;

            const newX = treeOffsetOnDragStart.current.left + deltaX;
            const newY = treeOffsetOnDragStart.current.top + deltaY;

            setTreeContentOffset({ left: newX, top: newY });
        }
    };

    // Завершение перетаскивания
    const handleMouseUp = () => {
        setIsDragging(false);
    };

    // Прекращение перетаскивания при выходе за пределы
    const handleMouseLeave = () => {
        setIsDragging(false);
    };

    const selectMostProbableSchema = () => {
        if (!workingSchemaController) {
            throw new Error('impossible');
        }

        workingSchemaController.selectMostProbableTree();
    };

    const handleSchemaConfirmation = async () => {
        if (!workingSchemaController) {
            throw new Error('impossible');
        }

        const finalSchema = workingSchemaController.buildFinalSchema();
        const result = finalSchema.toJson();

        // try {
        //     const response = await fetch('http://localhost:8000/schema/generatexsd/', {
        //         method: 'POST',
        //         headers: {
        //             'Content-Type': 'application/json',
        //         },
        //         body: JSON.stringify(result),
        //     });

        //     if (!response.ok) {
        //         throw new Error('Failed to generate XSD');
        //     }

        //     const blob = await response.blob();
        //     const url = window.URL.createObjectURL(blob);
        //     const a = document.createElement('a');
        //     a.href = url;
        //     a.download = `schema.xsd`;
        //     document.body.appendChild(a);
        //     a.click();
        //     a.remove();
        //     window.URL.revokeObjectURL(url);
        // } catch (error) {
        //     console.error('Error:', error);
        // }
        const jsonString = JSON.stringify(result, null, 4);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'data.json';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    if (!workingSchemaController) {
        return <Navigate to="/" />;
    }

    return (
        <div className={block()}>
            <div className={block('panel')}>
                <button onClick={selectMostProbableSchema}>Выбрать наиболее вероятный вариант</button>
                <button onClick={handleSchemaConfirmation}>Подтвердить</button>
            </div>
            <div className={block('workflow')}>
                <div
                    className={block('canvas')}
                    onWheel={handleWheel}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseLeave}
                    style={{
                        cursor: isDragging ? 'grabbing' : 'default',
                    }}
                >
                    <div
                        className={block('content')}
                        style={{
                            transform: `translate(${treeContentOffset.left}px, ${treeContentOffset.top}px)`,
                            transformOrigin: 'left top',
                        }}
                    >
                        <div
                            className={block('scale-wrapper')}
                            style={{ transform: `scale(${zoom})` }}
                        >
                            <TreeNode
                                node={workingSchemaController.getVirtualSchemaModel().getRoot()}
                                refToData={rootNodeRef}
                            />
                        </div>
                    </div>
                </div>
                <InspectNodeSidebar />
            </div>
        </div>
    );
};
