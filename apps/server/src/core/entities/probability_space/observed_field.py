from collections import Counter
from dataclasses import dataclass

from core.entities.probability_space import (
    Frequency,
    NameAlternative,
    SourceObservation,
    StructuralVariant,
)


@dataclass(frozen=True)
class ObservedField:
    """Keep consistent distributions and provenance for one contextual field."""

    id: str
    name: str
    path: tuple[str, ...]
    occurrences: int
    parent_occurrences: int
    presence_count: int
    name_alternatives: tuple[Frequency[NameAlternative], ...]
    data_types: tuple[Frequency[str], ...]
    representations: tuple[Frequency[str], ...]
    variants: tuple[Frequency[StructuralVariant], ...]
    sources: tuple[SourceObservation, ...]

    def __post_init__(self) -> None:
        """Freeze field evidence and reconcile its counts with source observations."""
        for attribute in (
            "path",
            "name_alternatives",
            "data_types",
            "representations",
            "variants",
            "sources",
        ):
            object.__setattr__(self, attribute, tuple(getattr(self, attribute)))

        # A field is identified within a full parent path: buyer/name and
        # seller/name remain different fields even though their final names match.
        if not self.id or not self.name or not self.path or self.path[-1] != self.name:
            raise ValueError(
                "A field needs an identifier and a path ending in its name."
            )

        # This model contains observed fields only. Each has at least one occurrence
        # and one containing parent, counted as whole observations rather than flags.
        if any(
            type(value) is not int or value < 1
            for value in (
                self.occurrences,
                self.parent_occurrences,
                self.presence_count,
            )
        ):
            raise ValueError("Field counts must be positive integers.")

        # Presence counts containing parents once, even when a field repeats within
        # a parent, so it cannot exceed either parent count or field occurrence count.
        if self.presence_count > min(self.occurrences, self.parent_occurrences):
            raise ValueError("Presence cannot exceed occurrence or parent counts.")

        for distribution in (
            self.name_alternatives,
            self.data_types,
            self.representations,
            self.variants,
        ):
            # Each occurrence contributes one spelling, type, representation and
            # structural variant; no occurrence may disappear from a distribution.
            if sum(item.count for item in distribution) != self.occurrences:
                raise ValueError(
                    "Each field distribution must account for every occurrence."
                )

            # These distributions describe present occurrences. Missing fields
            # affect presence frequency, not the denominator of observed value types.
            if any(item.total != self.occurrences for item in distribution):
                raise ValueError(
                    "Field distributions must use the occurrence denominator."
                )

            # A single outcome has one combined count; duplicate buckets would
            # split its evidence and make its frequency ambiguous to consumers.
            if len({item.value for item in distribution}) != len(distribution):
                raise ValueError("Distribution outcomes must be unique.")

        # Every counted occurrence needs provenance so inferred statistics remain
        # explainable in terms of the original documents.
        if len(self.sources) != self.occurrences:
            raise ValueError("Every field occurrence must have a source observation.")

        # Source and child references must identify exactly one structural choice.
        if len({item.value.id for item in self.variants}) != len(self.variants):
            raise ValueError("Field variant identifiers must be unique.")

        # Within a contextual field, one spelling cannot simultaneously be
        # classified as an original name, a typo and an alias.
        if len({item.value.name for item in self.name_alternatives}) != len(
            self.name_alternatives
        ):
            raise ValueError("Each observed spelling must have a single relation.")

        expected = (
            Counter({item.value.name: item.count for item in self.name_alternatives}),
            Counter({item.value: item.count for item in self.representations}),
            Counter({item.value.id: item.count for item in self.variants}),
        )
        actual = (
            Counter(source.name for source in self.sources),
            Counter(source.representation for source in self.sources),
            Counter(source.variant for source in self.sources),
        )

        # The stored spellings, representations and variant counts must reproduce
        # the evidence recorded in sources rather than describe invented observations.
        if expected != actual:
            raise ValueError(
                "Field distributions must agree with their source observations."
            )

    @property
    def presence_probability(self) -> float:
        """Return the fraction of parent observations containing this field."""
        return self.presence_count / self.parent_occurrences
