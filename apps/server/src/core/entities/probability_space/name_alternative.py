from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class NameAlternative:
    """Describe the original spelling and its relation to a canonical field name."""

    name: str
    relation: Literal["original", "typo", "alias"]

    def __post_init__(self) -> None:
        """Validate the spelling and its supported relation to the canonical name."""
        # Retain a source spelling and distinguish unchanged names, typos and aliases
        # so their observed frequencies remain separately explainable.
        if not self.name or self.relation not in ("original", "typo", "alias"):
            raise ValueError(
                "A name alternative needs a spelling and a valid relation."
            )
