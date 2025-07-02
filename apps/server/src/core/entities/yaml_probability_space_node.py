from dataclasses import dataclass
from typing import ClassVar

from core.entities import ProbabilitySpaceNode


@dataclass
class YamlProbabilitySpaceNode(ProbabilitySpaceNode):
    """Keep a YAML field or list item with its mapping, sequence or scalar type."""

    format: ClassVar[str] = "yaml"
