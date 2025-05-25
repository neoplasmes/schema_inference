from dataclasses import dataclass


@dataclass(frozen=True)
class Session:
    id: str
    filenames: tuple[str, ...]
    created_at: float
