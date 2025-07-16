from typing import Protocol

from core.entities.probability_space import ProbabilitySpace


class SchemaExpressionWriter(Protocol):
    """Present an analysis result in the schema editor's external contract."""

    def generate(self, space: ProbabilitySpace) -> str: ...
