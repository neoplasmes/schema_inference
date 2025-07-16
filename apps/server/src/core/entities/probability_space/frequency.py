from dataclasses import dataclass


@dataclass(frozen=True)
class Frequency[T]:
    """Describe a counted outcome with a probability derived from its sample size."""

    value: T
    count: int
    total: int

    def __post_init__(self) -> None:
        """Validate counts for an outcome observed in a finite sample."""
        # Counts represent individual observations, so fractions and flags are invalid.
        if type(self.count) is not int or type(self.total) is not int:
            raise ValueError("Frequency counts must be integers.")

        # Only observed outcomes are stored, and none can outnumber the whole sample.
        if not 0 < self.count <= self.total:
            raise ValueError("Frequency counts must satisfy 0 < count <= total.")

    @property
    def probability(self) -> float:
        """Return the observed relative frequency."""
        return self.count / self.total
