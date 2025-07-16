from dataclasses import dataclass


@dataclass(frozen=True)
class FieldObservation:
    """Keep one field observation after applying the schema simplifications."""

    name: str
    data_type: str
    value: str | int | float | bool | None
    children: tuple["FieldObservation", ...] = ()
    position: tuple[int, ...] = ()
    representation: str = "element"
