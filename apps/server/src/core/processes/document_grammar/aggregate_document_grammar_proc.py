from dataclasses import replace

from core.entities import ElementGrammarInterface
from core.entities.xml_node import XmlNode
from core.processes.document_grammar.read_document_grammar_proc import (
    read_document_grammar,
)


def aggregate_document_grammars(
    roots: list[XmlNode],
) -> dict[str, ElementGrammarInterface]:
    grammar: dict[str, ElementGrammarInterface] = {}
    root_name = None
    for root in roots:
        if root_name is None:
            root_name = root.tag.lower()
        document_grammar = read_document_grammar(replace(root, tag=root_name))
        if root.tag.lower() != root_name:
            suffix = "c" if root.children else "s"
            document_grammar[f"begin-c/{root_name}-{suffix}"].addSemanticStat(
                root.tag, 1
            )

        for key, element in document_grammar.items():
            if key not in grammar:
                grammar[key] = element
            else:
                grammar[key].mergeWith(element)
    return grammar
