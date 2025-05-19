from pathlib import Path

from application.use_cases.generate_schema import GenerateSchema
from application.use_cases.infer_schema import InferSchema
from infrastructure.tools.clustering.scipy import ScipyGrammarClusterer
from infrastructure.tools.document_grammar.xml import XmlDocumentGrammarReader
from infrastructure.tools.lexicon.wordnet import WordNetLexicon
from infrastructure.tools.schema.xsd import XSDGenerator
from infrastructure.tools.similarity.rapidfuzz import RapidFuzzSimilarity
from infrastructure.tools.similarity.sentence_transformer import (
    SentenceTransformerSimilarity,
)


SERVER_ROOT = Path(__file__).resolve().parents[2]


def build_infer_schema() -> InferSchema:
    return InferSchema(
        grammar_reader=XmlDocumentGrammarReader(),
        lexicon=WordNetLexicon(data_path=SERVER_ROOT / "nltk_data"),
        text_similarity=RapidFuzzSimilarity(),
        semantic_similarity=SentenceTransformerSimilarity(
            SERVER_ROOT / "FinetunedModel" / "bge_finetuned_nouns"
        ),
        clusterer=ScipyGrammarClusterer(),
    )


def build_generate_schema() -> GenerateSchema:
    return GenerateSchema(XSDGenerator())
