from collections import deque
from typing import Deque, Dict, Tuple
from xml.etree.ElementTree import Element

from domain.entities import ElementGrammarInterface, XSDType
from domain.entities.element_grammar import ElementGrammar
from domain.services.infer_xsd_type import inferXSDType


class XmlDocumentGrammarReader:
    def read(self, root: Element) -> Dict[str, ElementGrammarInterface]:
        nodeStack: Deque[Tuple[Element, Element]] = deque([(root, Element("begin"))])

        result: Dict[str, ElementGrammarInterface] = {}

        while len(nodeStack) > 0:
            currentNode, context = nodeStack.pop()
            currentNodeKey = (
                f"{context.tag}-c/"
                + currentNode.tag
                + ("-c" if len(currentNode) > 0 else "-s")
            )
            currentNodeKey = currentNodeKey.lower()

            if currentNodeKey in result:
                result[currentNodeKey].occurencies += 1
            else:
                result[currentNodeKey] = ElementGrammar(currentNodeKey)

            nodeXSDType = XSDType.PARENT
            if len(currentNode) > 0:
                productionRule = []

                for childNode in currentNode:
                    childNodeKey = childNode.tag + ("-c" if len(childNode) > 0 else "-s")
                    childNodeKey = childNodeKey.lower()

                    productionRule.append(childNodeKey)
                    nodeStack.append((childNode, currentNode))

                result[currentNodeKey].insertProductionRule(productionRule)
            else:
                nodeXSDType = inferXSDType(currentNode.text)

            result[currentNodeKey].addXSDTypeStat(nodeXSDType, 1)

            for attribute, value in currentNode.attrib.items():
                if (
                    "xsi" in attribute
                    or "noNamespaceSchemaLocation" in attribute
                    or "xmlns" in attribute
                ):
                    continue

                attrType = inferXSDType(value)

                result[currentNodeKey].insertAttribute(attribute, attrType)

        return result
