from typing import Callable, Dict, List, Protocol
from xml.etree.ElementTree import Element

from domain.entities import ElementGrammarInterface
from domain.entities.schema_node import SchemaNode


class Lexicon(Protocol):
    def contains(self, word: str) -> bool: ...

    def relatedness(self, first: str, second: str) -> float: ...


class TextSimilarity(Protocol):
    def compare(self, first: str, second: str) -> float: ...


class SemanticSimilarity(Protocol):
    def pair(self, first: str, second: str) -> float: ...

    def word_lists(self, first: List[str], second: List[str]) -> float: ...


class GrammarClusterer(Protocol):
    def cluster(
        self,
        grammars: Dict[str, ElementGrammarInterface],
        compare: Callable[[ElementGrammarInterface, ElementGrammarInterface], float],
        threshold: float,
    ) -> Dict[int, List[str]]: ...


class DocumentGrammarReader(Protocol):
    def read(self, root: Element) -> Dict[str, ElementGrammarInterface]: ...


class SchemaWriter(Protocol):
    def generate(self, root: SchemaNode) -> str: ...
