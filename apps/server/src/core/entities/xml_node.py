from dataclasses import dataclass, field


@dataclass
class XmlNode:
    tag: str
    text: str | None = None
    attributes: dict[str, str] = field(default_factory=dict)
    children: list["XmlNode"] = field(default_factory=list)

    def add_child(self, tag: str, attributes: dict[str, str] | None = None) -> "XmlNode":
        child = XmlNode(tag, attributes=attributes if attributes is not None else {})
        self.children.append(child)
        return child
