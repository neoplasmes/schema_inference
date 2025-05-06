import { useCallback, useRef, useState } from 'react';

import { Navigate } from 'react-router';

import { useSafelyWorkingSchemaController } from '@features/WorkingSchemaContext/components/WorkingSchemaContext';
import { bem } from '@shared/bem/bem';

import { TreeNode } from './components/TreeNode/TreeNode';
import './TreeView.scss';

const block = bem('TreeView');

type Position = {
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

    const workingSchemaController = useSafelyWorkingSchemaController();

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

        const treeNodeBodyClassName = rootNodeRef.current.className.split(' ')[0];
        console.log(treeNodeBodyClassName);
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

    if (!workingSchemaController) {
        return <Navigate to="/" />;
    }

    return (
        <div className={block()}>
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
                            ref={rootNodeRef}
                            parentBodyRef={undefined}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};
