from core.entities import ElementGrammarInterface
from core.entities.xml_node import XmlNode
from core.processes.document_grammar.read_document_grammar_proc import (
    read_document_grammar,
)


def aggregate_document_grammars(roots: list[XmlNode]) -> dict[str, ElementGrammarInterface]:
    grammar: dict[str, ElementGrammarInterface] = {}
    root_name = None
    for root in roots:
        if root_name is None:
            root_name = root.tag.lower()
        elif root.tag.lower() != root_name:
            grammar[f"begin-c/{root_name}-c"].addSemanticStat(root.tag, 1)
            root.tag = root_name

        for key, element in read_document_grammar(root).items():
            if key not in grammar:
                grammar[key] = element
            else:
                grammar[key].mergeWith(element)
    return grammar
