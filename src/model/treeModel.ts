import { Reactive } from '../interfaces/Reactive/Reactive';
import { assignObjectSkippingProperties } from '../shared/assignWithOmit';

export enum ExpressionNodeType {
    LEAF = 'LEAF',
    AND = 'AND',
    OR = 'OR',
}

export type SchemaDataEntryBase = {
    expression: ExpressionNode;
};

export type SchemaDataEntry = {
    typoSpace: Record<string, number>;
    semanticSpace: Record<string, number>;
    attributes: {
        [name: string]: {
            probability: number;
            XSDTypes: Record<string, number>;
        };
    };
    XSDTypes: Record<string, number>;
} & SchemaDataEntryBase;

export type ExpressionNode = {
    type: ExpressionNodeType;
    value: string;
    probability: number;
    minOccurs: number;
    maxOccurs: number;
    children: Array<ExpressionNode>;
};

/**
 * Представление узла в Virtual Schema Model
 */
export type SchemaNodeModel = Omit<ExpressionNode, 'children'> & {
    chosen: boolean;
    chosenAttributes: Array<string>;
    chosenType: string;
};

/**
 *
 *
 *
 *
 *
 *
 *
 *
 *
 *
 *
 *
 */

export type SchemaNodeDataType = Record<string, unknown>;
/**
 * Тип функции-обработчика изменений в модели
 */
type Listener<T> = (value: T) => void;

type SchemaNodeDataWithChildren<T extends SchemaNodeDataType> = T & { children: SchemaNode<T>[] };

/**
 * Представление узла модели {@link VirtualSchemaModel}
 *
 * @template T - тип данных узла. для большей гибкости задаётся именно как дженерик.
 */
export class SchemaNode<T extends SchemaNodeDataType> implements Reactive<SchemaNodeDataWithChildren<T>> {
    id: number;
    parentId: number;
    private data: T;
    children: SchemaNode<T>[];
    private listeners: Set<Listener<SchemaNodeDataWithChildren<T>>>;

    constructor(id: number, parentId: number, data: T) {
        this.id = id;
        this.data = data;
        this.children = [];
        this.parentId = parentId;
        this.listeners = new Set();
    }

    update(newData: Partial<SchemaNodeDataWithChildren<T>>): void {
        assignObjectSkippingProperties(this.data, newData, ['children']);
        this.children = newData.children ?? this.children;

        this.notify();
    }

    subscribe(listener: Listener<SchemaNodeDataWithChildren<T>>): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    getInternalData(): Readonly<SchemaNodeDataWithChildren<T>> {
        return { ...this.data, children: this.children };
    }

    private notify(): void {
        const notificationData = { ...this.data, children: this.children };

        this.listeners.forEach(listener => listener(notificationData));
    }
}

// Вспомогательный тип для описания структуры JSON-объекта
type JsonNode<T> = T & { children: JsonNode<T>[] };
/**
 * Модель схемы коллекции документов.
 * Описывает узлы и отношения между ними.
 * Не хранит конкретные данные об узлах.
 * Является вирутальной репрезентацией схемы, отображаемой в интерфейсе приложения.
 * В архитектуре ModelViewController представляет собой модель
 *
 * @template T - тип данных узла. для большей гибкости задаётся именно как дженерик.
 */
export class VirtualSchemaModel<T extends SchemaNodeDataType> {
    private root: SchemaNode<T>;
    private nodes: Map<number, SchemaNode<T>>;
    private identeficationSequence: number;

    constructor(rootValue: T) {
        this.identeficationSequence = 0;

        this.root = new SchemaNode<T>(this.identeficationSequence++, 0, rootValue);
        this.root.children = [];

        this.nodes = new Map();
        this.nodes.set(this.root.id, this.root);
    }

    getRoot(): SchemaNode<T> {
        return this.root;
    }

    /**
     * Метод для получения узла по ID
     * @param id - id узла
     * @returns - SchemaNode
     */
    getNodeById(id: number): SchemaNode<T> {
        const result = this.nodes.get(id);

        if (!result) {
            throw new Error(`Node with id \'${id}\ doesn't exist'`);
        }

        return result;
    }

    /**
     *
     * @param childId
     * @returns null, если запрошен для root. parentNode otherwise
     */
    getNodeParent(childId: number): SchemaNode<T> | null {
        if (childId === this.root.id) {
            return null;
        }

        const child = this.getNodeById(childId);

        return this.getNodeById(child.parentId);
    }

    /**
     * Метод для добавления нового узла (child to parent)
     * @param parentId
     * @param id
     * @param value
     * @returns ссылка на добывленный узел
     */
    addNode(parentId: number, value: T): SchemaNode<T> {
        const parent = this.nodes.get(parentId);

        if (!parent) {
            throw new Error(`Parent with id \'${parentId}\ doesn't exist'`);
        }

        const newNode = new SchemaNode<T>(this.identeficationSequence++, parentId, value);
        const newChildren = [...parent.children, newNode];

        parent.update({ children: newChildren } as SchemaNodeDataWithChildren<T>);

        this.nodes.set(newNode.id, newNode);

        return newNode;
    }

    /**
     * Преобразует дерево узлов в обычный JavaScript-объект, пригодный для сериализации в JSON.
     * Поля id и parentId исключаются, свойства из data поднимаются на уровень children.
     * Использует итеративный подход с помощью стека.
     * @returns Объект, представляющий дерево, где каждый узел имеет свойства из T и поле children.
     */
    toJson(): JsonNode<T> {
        // Стек для обработки узлов
        const stack: { node: SchemaNode<T>; jsonNode: JsonNode<T> }[] = [];
        // Карта для хранения JSON-объектов по id узлов
        const jsonNodes = new Map<number, JsonNode<T>>();

        // Инициализация корневого JSON-объекта
        const rootJson: JsonNode<T> = {
            ...this.root.getInternalData(),
            children: [],
        };
        jsonNodes.set(this.root.id, rootJson);
        stack.push({ node: this.root, jsonNode: rootJson });

        // Итеративный обход дерева
        while (stack.length > 0) {
            const { node, jsonNode } = stack.pop()!;

            // Обработка всех дочерних узлов
            for (const child of node.children) {
                const childJson: JsonNode<T> = {
                    ...child.getInternalData(),
                    children: [],
                };
                // Добавляем дочерний JSON-объект в массив children родителя
                jsonNode.children.push(childJson);
                // Сохраняем JSON-объект в карту
                jsonNodes.set(child.id, childJson);
                // Добавляем дочерний узел в стек для дальнейшей обработки
                stack.push({ node: child, jsonNode: childJson });
            }
        }

        return rootJson;
    }
}
