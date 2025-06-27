from dataclasses import dataclass, field


@dataclass
class XmlNode:
    """Keep element content and the namespace bindings available at that element."""

    tag: str
    text: str | None = None
    attributes: dict[str, str] = field(default_factory=dict)
    children: list["XmlNode"] = field(default_factory=list)
    tail: str | None = None
    namespaces: dict[str, str] = field(default_factory=dict)

    def add_child(
        self, tag: str, attributes: dict[str, str] | None = None
    ) -> "XmlNode":
        child = XmlNode(
            tag,
            attributes=attributes if attributes is not None else {},
            namespaces=dict(self.namespaces),
        )
        self.children.append(child)

        return child
