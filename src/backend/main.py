import json  # noqa: F401
import xml.etree.ElementTree as ET

from backend.entities import ExpressionNode
from backend.processes import (  # noqa: F401
    generateElementGrammarJSONEntry,
    getDocumentGrammar,
    mergeSemantics,
    mergeTypos,
)

simpleFile = "generated_xml/sample2.xml"
complexFile = "cornerCases/case2complexWithAttributes.xml"

with open(complexFile, "r") as source:
    XMLTree = ET.parse(source)

ig1 = getDocumentGrammar(XMLTree.getroot())

typosMerged = mergeTypos(ig1)

semanticsMerged = mergeSemantics(typosMerged)

# print("\n\n\n")

# typosCluster = clusterTypos(ig1)

# # for cluster_id, cluster_words in result.items():
# #     print(f"Cluster {cluster_id}: {cluster_words}")

# temp = getTyposMetaData(typosCluster, ig1)

# # print(temp.typosDict)
# # print(json.dumps(temp.typosDict, indent=2, ensure_ascii=False))
# result = mergeTypos(temp, ig1)

jsonPrep = {}
for key in semanticsMerged:
    jsonPrep[key] = generateElementGrammarJSONEntry(semanticsMerged[key])

with open("sample.json", "w") as f:
    json.dump(
        jsonPrep,
        f,
        indent=2,
        ensure_ascii=False,
        default=ExpressionNode.jsonSerializerExtension,
    )

# print("\n\n")
# print("\n")
# for tag, grammar in withExpr.items():
#     # print(grammar.name, grammar.occurencies, grammar.childrenFrequency)
#     # print(f"TyposSpace: {grammar.typoSpace}")
#     # print(f"AlternativeNames: {grammar.semanticSpace}")
#     # for rule in grammar.productionRules.values():
#     #     print(f"{rule.name} {rule.occurencies} {rule.exp_value}")
#     # print("\n")
#     print(grammar.name)
#     print_tree(grammar.grammarExpression)
# with open(simpleFile, 'r') as source:
#     XMLTree = ET.parse(source)

# ig2 = getInitialFrequencyGrammar(XMLTree.getroot())

# result = uniteDocumentGrammars([
#     ig1, ig2
# ])


# for tag, grammar in result.items():
#     productionRuleKeys = grammar.productionRules.keys()
#     print(productionRuleKeys)

# struct = generate_structure(list(result.values())[1])
