from dataclasses import dataclass


@dataclass(frozen=True)
class InferenceLimits:
    """Bound document traversal and local field-name comparisons."""

    max_documents: int = 10_000
    max_nodes: int = 1_000_000
    max_depth: int = 128
    max_names: int = 256

    def __post_init__(self) -> None:
        for value in (
            self.max_documents,
            self.max_nodes,
            self.max_depth,
            self.max_names,
        ):
            if type(value) is not int or value < 1:
                raise ValueError("Inference limits must be positive integers.")
