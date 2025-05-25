from dataclasses import dataclass
from typing import Any, Dict, List


@dataclass
class SchemaNode:
    chosenType: str
    name: str
    type: str
    minOccurs: int
    maxOccurs: int
    children: List["SchemaNode"]
    attributes: Dict[str, str]

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "SchemaNode":
        children = [cls.from_dict(child) for child in data.get("children", [])]
        return cls(
            chosenType=data.get("chosenType", ""),
            name=data.get("name", ""),
            type=data.get("type", ""),
            minOccurs=data.get("minOccurs", 1),
            maxOccurs=data.get("maxOccurs", 1),
            children=children,
            attributes=data.get("attributes", {}),
        )
