from collections.abc import Sequence
from typing import Protocol

from core.entities.matching import AlignmentRequest, AlignmentResult


class AssignmentTool(Protocol):
    def assign(
        self, requests: Sequence[AlignmentRequest]
    ) -> tuple[AlignmentResult, ...]: ...
