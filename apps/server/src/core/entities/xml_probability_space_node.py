from dataclasses import dataclass, field
from typing import ClassVar, Self

from core.entities import ProbabilitySpaceNode


@dataclass(init=False)
class XmlProbabilitySpaceNode(ProbabilitySpaceNode):
    """Keep element content and the namespace bindings available at that element."""

    attributes: dict[str, str] = field(default_factory=dict)
    tail: str | None = None
    namespaces: dict[str, str] = field(default_factory=dict)
    format: ClassVar[str] = "xml"

    def __init__(
        self,
        tag: str,
        text: str | None = None,
        attributes: dict[str, str] | None = None,
        children: list[Self] | None = None,
        tail: str | None = None,
        namespaces: dict[str, str] | None = None,
    ) -> None:
        """Accept the existing XML constructor while using the shared tree model."""
        super().__init__(
            tag,
            text,
            children if children is not None else [],
            node_kind="element",
            role="element",
        )
        self.attributes = attributes if attributes is not None else {}
        self.tail = tail
        self.namespaces = namespaces if namespaces is not None else {}

    def add_child(self, tag: str, attributes: dict[str, str] | None = None) -> Self:
        """Append an XML child with its own copy of the namespace bindings."""
        child = type(self)(
            tag,
            attributes=attributes if attributes is not None else {},
            namespaces=dict(self.namespaces),
        )
        self.children.append(child)

        return child
