from dataclasses import dataclass


@dataclass(frozen=True)
class NormalizedNode:
    """Keep one field observation after applying the schema simplifications."""

    name: str
    data_type: str
    value: str | int | float | bool | None
    children: tuple["NormalizedNode", ...] = ()
    position: tuple[int, ...] = ()
    representation: str = "element"
