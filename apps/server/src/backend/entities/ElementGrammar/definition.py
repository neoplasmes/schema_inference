from dataclasses import dataclass
from types import MappingProxyType
from typing import Dict, List, Optional

from backend.entities.XSDTypes.XSDTypes import XSDType

EG_CHILD_SEPARATOR = "|"


# С этим классом ниче не поделаешь. В отдельную папку засовывать его не хочу,
# поэтому здесь будет находиться сразу готовый класс
class ProductionRule:
    name: str

    occurencies: int

    # key - tagName, value - occurencies
    _content: Dict[str, int]

    @property
    def content(self):
        return MappingProxyType(self._content)

    def __init__(self, name: str, ruleValue: List[str] = []):
        self.name = name
        self.occurencies = 1
        self._content = dict()

        for element in ruleValue:
            if element in self.content:
                self._content[element] += 1
            else:
                self._content[element] = 1

    def clone(self) -> "ProductionRule":
        temp = ProductionRule(self.name)
        temp.occurencies = self.occurencies
        temp._content = self._content.copy()

        return temp

    def replaceTagInStats(self, oldTagName: str, newTagName: str) -> None:
        """
        Меняет имя (name). Обновляет статистику (content)
        """
        if oldTagName not in self._content:
            raise Exception("че ты мне дал")

        self._content[newTagName] = (
            self._content.get(newTagName, 0) + self._content[oldTagName]
        )

        del self._content[oldTagName]

        self.name = EG_CHILD_SEPARATOR.join(sorted(list(self._content.keys())))

    def updateByDuplicate(self, duplicate: "ProductionRule"):
        if duplicate.name != self.name:
            raise Exception(
                f"""
                Update of productionRule with name {self.name}
                cancelled because {duplicate.name} recieved instead of duplicate
                """
            )
        else:
            self.occurencies += 1
            for tag, duplicateCount in duplicate._content.items():
                if tag not in self._content:
                    raise Exception("Impossible")

                thisCount = self._content[tag]
                self._content[tag] = max(thisCount, duplicateCount)


class AttributeGrammar:
    """Внутреннее программное представление аттрибута некоего элемента"""

    name: str
    occurencies: int
    XSDTypes: Dict[XSDType, int]

    def __init__(
        self,
        name: str,
        *,
        occurencies: int = 1,
        XSDTypes: Optional[Dict[XSDType, int]] = None,
    ):
        self.name = name
        self.occurencies = occurencies
        self.XSDTypes = XSDTypes if XSDTypes is not None else {}

    def clone(self) -> "AttributeGrammar":
        return AttributeGrammar(
            self.name, occurencies=self.occurencies, XSDTypes=self.XSDTypes.copy()
        )

    def updateByDuplicate(self, duplicate: "AttributeGrammar") -> None:
        """
        Мерджит два одинаковых аттрибута (увеличивает occurencies, складывает типы)
        """

        if duplicate.name != self.name:
            raise Exception(
                f"""
                Update of productionRule with name {self.name}
                cancelled because {duplicate.name} recieved instead of duplicate
                """
            )
        else:
            self.occurencies += 1
            for xsdtype, count in duplicate.XSDTypes.items():
                self.XSDTypes[xsdtype] = self.XSDTypes.get(xsdtype, 0) + count


@dataclass(kw_only=True)
class ElementGrammarEntity:
    """Внутреннее программное представление порождающей грамматики некоего элемента"""

    name: str
    occurencies: int
    childrenDensity: Dict[str, int]
    productionRules: Dict[str, ProductionRule]
    semanticSpace: Dict[str, int]
    typoSpace: Dict[str, int]
    XSDTypes: Dict[str, int]
    attributes: Dict[str, AttributeGrammar]
