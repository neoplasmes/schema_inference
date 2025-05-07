from collections import deque
from typing import Deque, Dict, Tuple
from xml.etree.ElementTree import Element

from backend.entities import ElementGrammarInterface, XSDType
from backend.models.ElementGrammar.model import ElementGrammar
from backend.processes.getDocumentGrammar.helpers.inferXSDType import inferXSDType


def getDocumentGrammar(root: Element) -> Dict[str, ElementGrammarInterface]:
    # Первый элемент - текущий, второй - родитель
    nodeStack: Deque[Tuple[Element, Element]] = deque([(root, Element("begin"))])

    result: Dict[str, ElementGrammarInterface] = {}

    while len(nodeStack) > 0:
        currentNode, context = nodeStack.pop()
        # -с если содержит детей. -s если не содержит
        currentNodeKey = (
            f"{context.tag}-c/"
            + currentNode.tag
            + ("-c" if len(currentNode) > 0 else "-s")
        )
        currentNodeKey = currentNodeKey.lower()

        # Убедились, что статистика по тэгу уже  существует
        if currentNodeKey in result:
            result[currentNodeKey].occurencies += 1
        else:
            result[currentNodeKey] = ElementGrammar(currentNodeKey)

        # Если в тэге есть дети, то ставим тип PARENT и обрабатываем детей
        nodeXSDType = XSDType.PARENT
        if len(currentNode) > 0:
            productionRule = []

            for childNode in currentNode:
                childNodeKey = childNode.tag + ("-c" if len(childNode) > 0 else "-s")
                childNodeKey = childNodeKey.lower()

                productionRule.append(childNodeKey)
                # Контекстом для них будет их родитель, то есть текущий узел
                nodeStack.append((childNode, currentNode))

            result[currentNodeKey].insertProductionRule(productionRule)
        # если тэг содержит просто текст, то извлекаем тип с помощью своего софта
        else:
            nodeXSDType = inferXSDType(currentNode.text)

        result[currentNodeKey].addXSDTypeStat(nodeXSDType, 1)

        for attribute, value in currentNode.attrib.items():
            attrType = inferXSDType(value)

            result[currentNodeKey].insertAttribute(attribute, attrType)

    return result
