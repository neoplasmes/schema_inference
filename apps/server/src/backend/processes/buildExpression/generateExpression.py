import dataclasses
from typing import Dict, List, Optional, Set

from backend.entities import (
    ElementGrammarInterface,
    ExpressionNode,
    ExpressionNodeType,
    ProductionRule,
)


def simplifyNode(node: ExpressionNode) -> ExpressionNode:
    if node.type == ExpressionNodeType.LEAF:
        return node
    else:
        lastOperator = node.type
        newChildren: List[ExpressionNode] = []
        for child in node.children:
            # Лист просто добавляем
            if child.type == ExpressionNodeType.LEAF:
                newChildren.append(child)
            # Выпрямление вложенных одинаковых операторов
            elif (
                not child.type == ExpressionNodeType.LEAF and child.type == lastOperator
            ):
                extension = [
                    simplifyNode(operatorChild) for operatorChild in child.children
                ]
                for e in extension:
                    e.probability = child.probability * e.probability

                newChildren.extend(extension)
            # разные операторы просто добавляем
            else:
                newChildren.append(simplifyNode(child))

        if len(newChildren) == 1:
            # Если в операторе только один ребёнок - возвращаем только его перемножая вероятности
            newChildren[0].probability = node.probability * newChildren[0].probability
            return newChildren[0]
        else:
            # Если более - возвращаем с обновлёнными children
            node.children = newChildren
            return node


def expressionNodeIsValid(node: ExpressionNode) -> bool:
    if node.type == ExpressionNodeType.LEAF and len(node.children) == 0:
        return True
    elif node.type != ExpressionNodeType.LEAF and len(node.children) >= 1:
        return True
    else:
        return False


def print_tree(node: Optional[ExpressionNode], level: int = 0) -> None:
    """
    Печатает дерево выражений с отступами для отображения структуры.

    Args:
        node: Узел дерева выражений (может быть None).
        level: Уровень вложенности для отступов (по умолчанию 0).
    """
    if not node:
        print("  " * level + "None")
        return

    # Формируем строку для текущего узла
    prefix = f"({node.value})" if node.type == ExpressionNodeType.LEAF else ""
    print("  " * level + f"{node.type.name}{prefix}")

    # Рекурсивно печатаем всех детей
    for child in node.children:
        print_tree(child, level + 1)


# def expressionToDict(node: ExpressionNode) -> Dict:
#     """
#     Преобразует дерево выражений в JSON-объект.

#     Args:
#         node: Узел дерева выражений.

#     Returns:
#         Dict: JSON-представление узла с полями name и children.
#     """

#     return result


def generateExpression(
    data: Dict[str, ProductionRule],
    tagsToExclude: Set[str],
    contextWeight: float,
    previousContextWeight: float,
) -> ExpressionNode:
    #######################################
    # НАЧАЛО СБОРА СТАТЫ ПО ТЕКУЩЕЙ ВЕТКЕ #
    #######################################
    weightedTags: Dict[str, float] = {}
    mostValuableCandidates: Set[str] = set()
    maxWeight = 0
    for rule in data.values():
        for tag in rule.content:
            if tag in tagsToExclude:
                continue

            weightedTags[tag] = weightedTags.get(tag, 0) + rule.occurencies

            if weightedTags[tag] > maxWeight:
                maxWeight = weightedTags[tag]

                mostValuableCandidates.clear()
                mostValuableCandidates.add(tag)

            elif weightedTags[tag] == maxWeight:
                mostValuableCandidates.add(tag)

    if not mostValuableCandidates:
        return ExpressionNode(ExpressionNodeType.AND)

    mostValuableTag = min(mostValuableCandidates)
    #################### КОНЕЦ #######################

    splitResult: List[ExpressionNode] = []

    rulesWithMostValuableTag = {
        key: rule for key, rule in data.items() if mostValuableTag in rule.content
    }
    # Контекстный вес веточки
    withMostWeight = sum(rule.occurencies for rule in rulesWithMostValuableTag.values())
    # создаётся блядское OR. какая вероятность у блядского OR?
    if rulesWithMostValuableTag:
        mvMaxOccurs = max(
            [x.content[mostValuableTag] for x in rulesWithMostValuableTag.values()]
        )

        mostValuableNode = ExpressionNode(
            ExpressionNodeType.LEAF,
            value=mostValuableTag,
            # Логично. хотя вообще-то всегда будет 1.
            probability=weightedTags[mostValuableTag] / withMostWeight,
            # TODO: адекватный расчёт minOcc
            minOccurs=1,
            maxOccurs=mvMaxOccurs,
        )

        other = generateExpression(
            rulesWithMostValuableTag,
            tagsToExclude.union([mostValuableTag]),
            withMostWeight,
            withMostWeight,
        )

        children = [mostValuableNode]
        if expressionNodeIsValid(other):
            children.append(other)

        # здесь считаем ебаное нахуй ненавижу блять. кол-во появлений всякой залупы в ветке/контекст = заебись результат
        node1 = ExpressionNode(
            ExpressionNodeType.AND,
            children=children,
            probability=withMostWeight / contextWeight,
        )

        splitResult.append(node1)

    # Правила без mostValuableTag
    rulesWithoutMostValuableTag = {
        key: rule for key, rule in data.items() if mostValuableTag not in rule.content
    }
    withoutMostWeight = sum(
        rule.occurencies for rule in rulesWithoutMostValuableTag.values()
    )

    if rulesWithoutMostValuableTag:
        node2 = generateExpression(
            rulesWithoutMostValuableTag,
            tagsToExclude.union([mostValuableTag]),
            withoutMostWeight,
            contextWeight,
        )

        if expressionNodeIsValid(node2):
            splitResult.append(node2)

    node = None
    if len(splitResult) > 1:
        splitResult[0].probability = withMostWeight / contextWeight
        splitResult[1].probability = withoutMostWeight / contextWeight

        node = ExpressionNode(
            ExpressionNodeType.OR,
            children=splitResult,
            # ПОЧЕМУ
            probability=contextWeight / previousContextWeight,
        )
    else:
        node = splitResult[0]

    simplifiedNode = simplifyNode(node)

    return simplifiedNode


def getNormalizedAttributes(grammar: ElementGrammarInterface) -> Dict:
    result = {}

    totalOccurencies = grammar.occurencies

    for key, attributeGrammar in grammar.attributes.items():
        name = attributeGrammar.name
        attrProbability = attributeGrammar.occurencies / totalOccurencies

        attrTypesAsProbs = {
            k.value: v / attributeGrammar.occurencies
            for k, v in attributeGrammar.XSDTypes.items()
        }

        result[name] = {
            "probability": attrProbability,
            "XSDTypes": attrTypesAsProbs,
        }

    return result


def generateElementGrammarJSONEntry(grammar: ElementGrammarInterface) -> Dict:
    XSDTypesAsProbs: Dict[str, float] = {}
    for key, value in grammar.XSDTypes.items():
        XSDTypesAsProbs[key] = value / grammar.occurencies

    typoSpaceAsProbabilities: Dict[str, float] = {}
    for key, value in grammar.typoSpace.items():
        typoSpaceAsProbabilities[key] = value / grammar.occurencies

    semanticSpaceAsProbabilities: Dict[str, float] = {}
    for key, value in grammar.semanticSpace.items():
        semanticSpaceAsProbabilities[key] = value / grammar.occurencies

    normalizedAttributes = getNormalizedAttributes(grammar)

    expression = generateExpression(
        dict(grammar.productionRules), set(), grammar.occurencies, grammar.occurencies
    )

    # Такой dict останется в случае, если вернулось пустое AND или пустое OR,
    # то есть грамматика описывает простой элемент
    normalizedExpression = dict()
    # Если всё окей, то возвращаем нормальный словарь
    if expressionNodeIsValid(expression):
        normalizedExpression = dataclasses.asdict(expression)

    return {
        "typoSpace": typoSpaceAsProbabilities,
        "semanticSpace": semanticSpaceAsProbabilities,
        "expression": normalizedExpression,
        "XSDTypes": XSDTypesAsProbs,
        "attributes": normalizedAttributes,
    }
