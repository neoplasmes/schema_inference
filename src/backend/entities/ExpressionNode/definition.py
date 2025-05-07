from dataclasses import KW_ONLY, dataclass, field
from enum import Enum
from typing import List


class ExpressionNodeType(Enum):
    AND = "AND"
    OR = "OR"
    LEAF = "LEAF"


@dataclass
class ExpressionNode:
    type: ExpressionNodeType

    _: KW_ONLY
    # имя тэга без указания родительского для type = LEAF
    value: str = ""

    probability: float = 1

    minOccurs: int = 1

    maxOccurs: int = 1

    # аргументы операнда для AND и OR
    # AND(child1, child2, child3, ...)
    children: List["ExpressionNode"] = field(default_factory=list)

    def __post_init__(self):
        if self.value == "" and not self.type == ExpressionNodeType.LEAF:
            self.value = self.type.value
        elif self.value == "":
            raise Exception("value has not been provided for LEAF node")

    @staticmethod
    def jsonSerializerExtension(obj: object):
        if isinstance(obj, ExpressionNodeType):
            return obj.value

        raise TypeError(f"Cannot serialize object of {type(obj)}")
