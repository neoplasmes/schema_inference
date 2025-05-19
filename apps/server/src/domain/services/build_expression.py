import dataclasses
from typing import Dict, List, Set

from domain.entities import (
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
            if child.type == ExpressionNodeType.LEAF:
                newChildren.append(child)
            elif (
                not child.type == ExpressionNodeType.LEAF and child.type == lastOperator
            ):
                extension = [
                    simplifyNode(operatorChild) for operatorChild in child.children
                ]
                for e in extension:
                    e.probability = child.probability * e.probability

                newChildren.extend(extension)
            else:
                newChildren.append(simplifyNode(child))

        if len(newChildren) == 1:
            newChildren[0].probability = node.probability * newChildren[0].probability
            return newChildren[0]
        else:
            node.children = newChildren
            return node


def expressionNodeIsValid(node: ExpressionNode) -> bool:
    if node.type == ExpressionNodeType.LEAF and len(node.children) == 0:
        return True
    elif node.type != ExpressionNodeType.LEAF and len(node.children) >= 1:
        return True
    else:
        return False



def generateExpression(
    data: Dict[str, ProductionRule],
    tagsToExclude: Set[str],
    contextWeight: float,
    previousContextWeight: float,
) -> ExpressionNode:
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

    splitResult: List[ExpressionNode] = []

    rulesWithMostValuableTag = {
        key: rule for key, rule in data.items() if mostValuableTag in rule.content
    }
    withMostWeight = sum(rule.occurencies for rule in rulesWithMostValuableTag.values())
    if rulesWithMostValuableTag:
        mvMaxOccurs = max(
            [x.content[mostValuableTag] for x in rulesWithMostValuableTag.values()]
        )

        mostValuableNode = ExpressionNode(
            ExpressionNodeType.LEAF,
            value=mostValuableTag,
            probability=weightedTags[mostValuableTag] / withMostWeight,
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

        node1 = ExpressionNode(
            ExpressionNodeType.AND,
            children=children,
            probability=withMostWeight / contextWeight,
        )

        splitResult.append(node1)

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

    normalizedExpression = dict()
    if expressionNodeIsValid(expression):
        normalizedExpression = dataclasses.asdict(expression)

    return {
        "typoSpace": typoSpaceAsProbabilities,
        "semanticSpace": semanticSpaceAsProbabilities,
        "expression": normalizedExpression,
        "XSDTypes": XSDTypesAsProbs,
        "attributes": normalizedAttributes,
    }
