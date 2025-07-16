from dataclasses import dataclass


@dataclass(frozen=True)
class VariantReference:
    """Identify one structural alternative of a field within a result."""

    node: str
    variant: str

    def __post_init__(self) -> None:
        """Require both parts of a reference to an observed structural variant."""
        # A structural choice identifies both the contextual field and its variant;
        # omitting either would leave the observed document structure ambiguous.
        if not self.node or not self.variant:
            raise ValueError(
                "Variant references require field and variant identifiers."
            )
