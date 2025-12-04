from dataclasses import dataclass


@dataclass(frozen=True)
class ResourceChange:
    """Describe a committed mutation of one resource that cached copies must follow."""

    kind: str
    resource_id: str
    deleted: bool = False
