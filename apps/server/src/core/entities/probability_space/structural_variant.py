from dataclasses import dataclass
from typing import Literal

from core.entities.probability_space import VariantReference


@dataclass(frozen=True)
class StructuralVariant:
    """Keep an observed structure without inventing combinations of child variants."""

    id: str
    kind: Literal["fields", "value"]
    children: tuple[VariantReference, ...] = ()

    def __post_init__(self) -> None:
        """Freeze child references and validate the structural alternative."""
        object.__setattr__(self, "children", tuple(self.children))

        # Referenced alternatives need an identity and must distinguish structured
        # field content from scalar content, such as an address versus address text.
        if not self.id or self.kind not in ("fields", "value"):
            raise ValueError(
                "A structural variant needs an identifier and a valid kind."
            )

        # Repeating the same child alternative does not create a new shape under
        # the inference policy, so a shape lists each child reference only once.
        if len(set(self.children)) != len(self.children):
            raise ValueError("Structural child references must be unique.")
