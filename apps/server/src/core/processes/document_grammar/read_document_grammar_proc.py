from collections import deque
from typing import Deque, Dict, Tuple

from core.entities import ElementGrammarInterface, XSDType
from core.entities.element_grammar import ElementGrammar
from core.entities.xml_node import XmlNode
from core.processes.document_grammar.infer_xsd_type import inferXSDType


def read_document_grammar(root: XmlNode) -> Dict[str, ElementGrammarInterface]:
    nodeStack: Deque[Tuple[XmlNode, XmlNode]] = deque([(root, XmlNode("begin"))])

    result: Dict[str, ElementGrammarInterface] = {}

    while len(nodeStack) > 0:
        currentNode, context = nodeStack.pop()
        currentNodeKey = (
            f"{context.tag}-c/"
            + currentNode.tag
            + ("-c" if len(currentNode.children) > 0 else "-s")
        )
        currentNodeKey = currentNodeKey.lower()

        if currentNodeKey in result:
            result[currentNodeKey].occurencies += 1
        else:
            result[currentNodeKey] = ElementGrammar(currentNodeKey)

        nodeXSDType = XSDType.PARENT
        if len(currentNode.children) > 0:
            productionRule = []

            for childNode in currentNode.children:
                childNodeKey = childNode.tag + (
                    "-c" if len(childNode.children) > 0 else "-s"
                )
                childNodeKey = childNodeKey.lower()

                productionRule.append(childNodeKey)
                nodeStack.append((childNode, currentNode))

            result[currentNodeKey].insertProductionRule(productionRule)
        else:
            nodeXSDType = inferXSDType(currentNode.text)

        result[currentNodeKey].addXSDTypeStat(nodeXSDType, 1)

        for attribute, value in currentNode.attributes.items():
            if (
                "xsi" in attribute
                or "noNamespaceSchemaLocation" in attribute
                or "xmlns" in attribute
            ):
                continue

            attrType = inferXSDType(value)

            result[currentNodeKey].insertAttribute(attribute, attrType)

    return result
