from collections.abc import Sequence

from app.ports.tools.lexical_resource import LexicalResourceTool
from app.ports.tools.schema_expression import SchemaExpressionWriter
from app.use_cases.infer_schema import InferSchemaError
from core.entities import DocumentNode
from core.entities.inference import InferenceLimits
from core.entities.lexical import LexiconData
from core.entities.probability_space import ProbabilitySpace
from core.processes.build_probability_space import build_probability_space
from core.processes.normalize_documents import (
    NormalizeDocumentsError,
    normalize_documents,
)


class InferSchema:
    """Collect observed alternatives and expose them through the existing editor contract."""

    def __init__(
        self,
        *,
        expression_writer: SchemaExpressionWriter,
        lexical_resource: LexicalResourceTool | None = None,
        limits: InferenceLimits | None = None,
    ) -> None:
        self._expression_writer = expression_writer
        self._lexical_resource = lexical_resource
        self._limits = limits or InferenceLimits()

    def analyze(self, roots: Sequence[DocumentNode]) -> ProbabilitySpace:
        """Return empirical field and structure frequencies without semantic hypotheses."""
        try:
            normalized = normalize_documents(roots, self._limits)
        except NormalizeDocumentsError as error:
            raise InferSchemaError(str(error)) from error

        lexicon = (
            self._lexical_resource.load()
            if normalized and self._lexical_resource is not None
            else LexiconData(unigrams={})
        )

        return build_probability_space(normalized, lexicon, self._limits)

    def execute(self, roots: Sequence[DocumentNode]) -> str:
        """Return the editor's schema dictionary with expanded observed alternatives."""
        return self._expression_writer.generate(self.analyze(roots))
