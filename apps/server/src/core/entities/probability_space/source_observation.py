from dataclasses import dataclass


@dataclass(frozen=True)
class SourceObservation:
    """Locate a field occurrence and the structural variant observed there."""

    document: int
    position: tuple[int, ...]
    name: str
    representation: str
    variant: str

    def __post_init__(self) -> None:
        """Freeze the source location and require traceable observation metadata."""
        object.__setattr__(self, "position", tuple(self.position))

        # Document and child positions are zero-based indexes into source trees;
        # negative or fractional positions cannot locate an observed field.
        if any(
            type(value) is not int or value < 0
            for value in (self.document, *self.position)
        ):
            raise ValueError("Observation locations must be nonnegative integers.")

        # Every counted occurrence retains its original spelling, representation
        # and structural alternative so the inferred field can be traced to input.
        if not self.name or not self.representation or not self.variant:
            raise ValueError("An observation needs a name, representation and variant.")
