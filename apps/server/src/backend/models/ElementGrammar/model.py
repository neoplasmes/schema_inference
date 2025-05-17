import re
from collections import Counter
from types import MappingProxyType
from typing import Dict, List, Optional

from backend.entities import (
    ElementGrammarEntity,
    ElementGrammarInterface,
    ProductionRule,
)
from backend.entities.ElementGrammar.definition import (
    EG_CHILD_SEPARATOR,
    AttributeGrammar,
)
from backend.entities.ElementGrammar.interface import ClearEGContext
from backend.entities.XSDTypes.XSDTypes import XSDType


class ElementGrammar(ElementGrammarInterface):
    _data: ElementGrammarEntity

    def __init__(
        self,
        name: str,
        *,
        occurencies: int = 1,
        childrenDensity: Optional[Dict[str, int]] = None,
        productionRules: Optional[Dict[str, ProductionRule]] = None,
        semanticSpace: Optional[Dict[str, int]] = None,
        typoSpace: Optional[Dict[str, int]] = None,
        XSDTypes: Optional[Dict[str, int]] = None,
        attributes: Optional[Dict[str, AttributeGrammar]] = None,
    ):
        self._data = ElementGrammarEntity(
            name=name,
            occurencies=occurencies,
            childrenDensity=childrenDensity if childrenDensity is not None else dict(),
            productionRules=productionRules if productionRules is not None else dict(),
            semanticSpace=semanticSpace if semanticSpace is not None else dict(),
            typoSpace=typoSpace if typoSpace is not None else dict(),
            XSDTypes=XSDTypes if XSDTypes is not None else dict(),
            attributes=attributes if attributes is not None else dict(),
        )

    @property
    def occurencies(self) -> int:
        return self._data.occurencies

    @occurencies.setter
    def occurencies(self, value: int):
        if not isinstance(value, int):
            raise TypeError("Integer expected")
        self._data.occurencies = value

    @property
    def childrenDensity(self) -> MappingProxyType[str, int]:
        return MappingProxyType(self._data.childrenDensity)

    @property
    def productionRules(self) -> MappingProxyType[str, ProductionRule]:
        return MappingProxyType(self._data.productionRules)

    @property
    def XSDTypes(self) -> MappingProxyType[str, int]:
        return MappingProxyType(self._data.XSDTypes)

    @property
    def typoSpace(self) -> MappingProxyType[str, int]:
        return MappingProxyType(self._data.typoSpace)

    @property
    def semanticSpace(self) -> MappingProxyType[str, int]:
        return MappingProxyType(self._data.semanticSpace)

    @property
    def attributes(self) -> MappingProxyType[str, AttributeGrammar]:
        return MappingProxyType(self._data.attributes)

    @property
    def isSimple(self) -> bool:
        suffix = self._data.name.split("/")[1].split("-")[1]

        return suffix == "s"

    @property
    def context(self) -> ClearEGContext:
        splittedKey = self._data.name.split("/")

        parentWithSuffix, nameWithSuffix = splittedKey[0], splittedKey[1]

        tag = nameWithSuffix.split("-")[0]
        parent = parentWithSuffix.split("-")[0]

        clearedChildren = [x.split("-")[0] for x in self._data.childrenDensity.keys()]

        return ClearEGContext(tag=tag, parent=parent, children=clearedChildren)

    def clone(self) -> "ElementGrammar":
        productionRulesCopy = {
            k: v.clone() for k, v in self._data.productionRules.items()
        }

        attributesCopy = {k: v.clone() for k, v in self._data.attributes.items()}

        return ElementGrammar(
            name=self._data.name,
            occurencies=self._data.occurencies,
            childrenDensity=self._data.childrenDensity.copy(),
            productionRules=productionRulesCopy,
            semanticSpace=self._data.semanticSpace.copy(),
            typoSpace=self._data.typoSpace.copy(),
            XSDTypes=self._data.XSDTypes.copy(),
            attributes=attributesCopy,
        )

    def insertProductionRule(self, childList: List[str]) -> None:
        """
        Функция автоматически обновляет всю статистику по дочерним элементам и добавляет новое порождающее правило
        """
        separator = EG_CHILD_SEPARATOR

        # Устанавливаем лексикографический порядок и удаляем дубликаты, чтобы избежать порождения неоднозначных правил
        ruleWithOmmitedDuplicates = set(childList)
        normalizedProductionRule = sorted(ruleWithOmmitedDuplicates, key=str.lower)

        # Создаём новый инстанс порождающего правила
        productionRuleKey = separator.join(normalizedProductionRule)
        newProductionRule = ProductionRule(productionRuleKey, childList)

        if productionRuleKey in self._data.productionRules:
            self._data.productionRules[productionRuleKey].updateByDuplicate(
                newProductionRule
            )
        else:
            self._data.productionRules[productionRuleKey] = newProductionRule

        # Собираем статистику по плотности дочерних элементов
        for tag in ruleWithOmmitedDuplicates:
            self._data.childrenDensity[tag] = self._data.childrenDensity.get(tag, 0) + 1

    def insertAttribute(self, name: str, xsdtype: XSDType) -> None:
        mockXsdTypesDict = {xsdtype: 1}
        attributeInstance = AttributeGrammar(
            name, occurencies=1, XSDTypes=mockXsdTypesDict
        )

        if name in self._data.attributes:
            self._data.attributes[name].updateByDuplicate(attributeInstance)
        else:
            self._data.attributes[name] = attributeInstance

    def addXSDTypeStat(self, XSDType: XSDType, occurencies: int) -> None:
        self._data.XSDTypes[XSDType.value] = (
            self._data.XSDTypes.get(XSDType.value, 0) + 1
        )

    def addTypoStat(self, typoName: str, occurencies: int) -> None:
        self._data.typoSpace[typoName] = (
            self._data.typoSpace.get(typoName, 0) + occurencies
        )

    def addSemanticStat(self, alternativeName: str, occurencies: int) -> None:
        self._data.semanticSpace[alternativeName] = (
            self._data.semanticSpace.get(alternativeName, 0) + occurencies
        )

    def replaceTagInStats(self, oldTagName: str, newTagName: str) -> None:
        delimiter = re.escape(EG_CHILD_SEPARATOR)
        # regex для поиска удаляемого имени в порождающих грамматиках
        regex = re.compile(
            rf"^{re.escape(oldTagName)}{delimiter}|{delimiter}{re.escape(oldTagName)}{delimiter}|{delimiter}{re.escape(oldTagName)}$"  # noqa: E501
        )

        newProductionRules: Dict[str, ProductionRule] = {}

        def addProductionRule(key: str, rule: ProductionRule) -> None:
            if key in newProductionRules:
                newProductionRules[key].updateByDuplicate(rule)
            else:
                # Если нет - добавляем
                newProductionRules[key] = rule

        for oldRuleKey, oldProductionRule in self._data.productionRules.items():
            if len(re.findall(regex, oldRuleKey)) < 1:
                addProductionRule(oldRuleKey, oldProductionRule)
                continue

            # Если мы нашли тэг, который нужно заменить:
            fixedProductionRule = oldProductionRule.clone()
            fixedProductionRule.replaceTagInStats(oldTagName, newTagName)

            fixedKey = fixedProductionRule.name

            addProductionRule(fixedKey, fixedProductionRule)

        # childrenDensity нужно пересчитывать с самого нуля,
        # так как мы собираем статистику типа вошёл/не вошёл в текущем правиле
        newChildrenDensity: Dict[str, int] = dict()
        for rule in newProductionRules.values():
            for tag in rule.content:
                newChildrenDensity[tag] = (
                    newChildrenDensity.get(tag, 0) + rule.occurencies
                )

        self._data.productionRules = newProductionRules
        self._data.childrenDensity = newChildrenDensity

    def mergeWith(self, other: ElementGrammarInterface) -> ElementGrammarInterface:
        self._data.occurencies += other.occurencies

        self._data.XSDTypes = dict(
            Counter(self._data.XSDTypes) + Counter(other.XSDTypes)
        )

        self._data.childrenDensity = dict(
            Counter(self._data.childrenDensity) + Counter(other.childrenDensity)
        )

        self._data.typoSpace = dict(
            Counter(self._data.typoSpace) + Counter(other.typoSpace)
        )

        self._data.semanticSpace = dict(
            Counter(self._data.semanticSpace) + Counter(other.semanticSpace)
        )

        for key, rule in other.productionRules.items():
            if key in self._data.productionRules:
                self._data.productionRules[key].updateByDuplicate(rule)
            else:
                self._data.productionRules[key] = rule

        for key, attribute in other.attributes.items():
            if key in self._data.attributes:
                self._data.attributes[key].updateByDuplicate(attribute)
            else:
                self._data.attributes[key] = attribute

        return self
