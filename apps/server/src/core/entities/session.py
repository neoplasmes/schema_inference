from dataclasses import dataclass


@dataclass(frozen=True)
class Session:
    """Identify uploaded documents and the time their session was created."""

    id: str
    filenames: tuple[str, ...]
    created_at: float
