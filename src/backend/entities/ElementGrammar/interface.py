from abc import ABC, abstractmethod
from dataclasses import KW_ONLY, dataclass
from types import MappingProxyType
from typing import List

from backend.entities.ElementGrammar.definition import AttributeGrammar, ProductionRule
from backend.entities.XSDTypes.XSDTypes import XSDType


@dataclass
class ClearEGContext:
    _: KW_ONLY
    tag: str

    parent: str

    children: List[str]


class ElementGrammarInterface(ABC):
    @property
    @abstractmethod
    def occurencies(self) -> int:
        pass

    @occurencies.setter
    @abstractmethod
    def occurencies(self, value):
        pass

    @property
    @abstractmethod
    def childrenDensity(self) -> MappingProxyType[str, int]:
        pass

    @property
    @abstractmethod
    def XSDTypes(self) -> MappingProxyType[str, int]:
        pass

    @property
    @abstractmethod
    def productionRules(self) -> MappingProxyType[str, ProductionRule]:
        pass

    @property
    @abstractmethod
    def typoSpace(self) -> MappingProxyType[str, int]:
        pass

    @property
    @abstractmethod
    def semanticSpace(self) -> MappingProxyType[str, int]:
        pass

    @property
    @abstractmethod
    def attributes(self) -> MappingProxyType[str, AttributeGrammar]:
        pass

    @property
    @abstractmethod
    def isSimple(self) -> bool:
        """Тэг содержит данные(True), или другие тэги(False)"""
        pass

    @property
    @abstractmethod
    def context(self) -> ClearEGContext:
        """Чистое имя тэга, родителя, детей"""
        pass

    @abstractmethod
    def clone(self) -> "ElementGrammarInterface":
        pass

    @abstractmethod
    def insertProductionRule(self, childList: List[str]) -> None:
        pass

    @abstractmethod
    def insertAttribute(self, name: str, xsdtype: XSDType) -> None:
        pass

    @abstractmethod
    def addXSDTypeStat(self, XSDType: XSDType, occurencies: int) -> None:
        pass

    @abstractmethod
    def addTypoStat(self, typoName: str, occurencies: int) -> None:
        pass

    @abstractmethod
    def addSemanticStat(self, alternativeName: str, occurencies: int) -> None:
        pass

    @abstractmethod
    def replaceTagInStats(self, oldTagName: str, newTagName: str) -> None:
        pass

    @abstractmethod
    def mergeWith(self, other: "ElementGrammarInterface") -> "ElementGrammarInterface":
        pass
