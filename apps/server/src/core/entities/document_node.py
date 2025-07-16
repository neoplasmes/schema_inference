from dataclasses import dataclass, field
from typing import ClassVar, Self


@dataclass
class DocumentNode:
    """Keep the original name, content and role of a parsed document node."""

    tag: str
    text: str | None = None
    children: list[Self] = field(default_factory=list)
    node_kind: str = field(default="scalar", kw_only=True)
    role: str = field(default="field", kw_only=True)
    ordered: bool = field(default=True, kw_only=True)
    value_type: str | None = field(default=None, kw_only=True)
    value: str | int | float | bool | None = field(default=None, kw_only=True)
    format: ClassVar[str] = "document"
