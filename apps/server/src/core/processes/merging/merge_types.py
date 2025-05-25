from typing import Callable

from core.entities import ElementGrammarInterface

GrammarMap = dict[str, ElementGrammarInterface]
CompareGrammars = Callable[[ElementGrammarInterface, ElementGrammarInterface], float]
ClusterGrammars = Callable[[GrammarMap, CompareGrammars, float], dict[int, list[str]]]
