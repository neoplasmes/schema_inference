from dataclasses import dataclass
from typing import Any


@dataclass
class SchemaGraph:
    """Keep an editable document's nodes and ordered member collections."""

    root_node_id: str
    profile: dict[str, str]
    nodes: dict[str, dict[str, Any]]
    collections: dict[str, list[dict[str, Any]]]
