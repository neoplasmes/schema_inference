import math
import re
from collections.abc import Sequence
from datetime import date, datetime

from core.entities import XmlNode as ProbabilitySpaceNode
from core.entities.inference import InferenceLimits, NormalizedNode
from core.processes.normalize_documents import NormalizeDocumentsError

XSI = "{http://www.w3.org/2001/XMLSchema-instance}"


def _xml_type(value: str) -> str:
    text = value.strip()

    if not text:
        return "null"

    if text in ("true", "false"):
        return "boolean"

    if re.fullmatch(r"[+-]?(?:0|[1-9][0-9]*)", text):
        return "integer"

    if re.fullmatch(r"[+-]?(?:[0-9]+\.[0-9]*|\.[0-9]+)", text):
        return "decimal"

    if re.fullmatch(r"[+-]?[0-9]+(?:\.[0-9]+)?[eE][+-]?[0-9]+", text):
        if math.isfinite(float(text)):
            return "double"

    try:
        if re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", text):
            date.fromisoformat(text)

            return "date"

        if "T" in text:
            datetime.fromisoformat(text.replace("Z", "+00:00"))

            return "dateTime"
    except ValueError:
        pass

    return "string"


def normalize_documents(
    roots: Sequence[ProbabilitySpaceNode], limits: InferenceLimits | None = None
) -> tuple[NormalizedNode, ...]:
    """Unify empty values and attribute fields, and flatten text decorations."""
    limits = limits or InferenceLimits()

    if len(roots) > limits.max_documents:
        raise NormalizeDocumentsError("The document count exceeds max_documents.")

    count = 0
    active: set[int] = set()

    def visit(node: ProbabilitySpaceNode, position: tuple[int, ...]) -> NormalizedNode:
        nonlocal count
        count += 1

        if count > limits.max_nodes or len(position) >= limits.max_depth:
            raise NormalizeDocumentsError("The input exceeds node or depth limits.")

        if id(node) in active:
            raise NormalizeDocumentsError("The document contains a cycle.")

        if not isinstance(node.tag, str) or not node.tag:
            raise NormalizeDocumentsError("Field names must be nonempty strings.")

        active.add(id(node))
        children = tuple(
            visit(child, (*position, index))
            for index, child in enumerate(node.children)
        )
        active.remove(id(node))

        attributes = getattr(node, "attributes", {})
        nil = attributes.get(XSI + "nil", "false").strip()

        if nil not in ("true", "false", "1", "0"):
            raise NormalizeDocumentsError("Invalid xsi:nil value.")

        fields = tuple(
            NormalizedNode(
                name, _xml_type(value), value or None, (), position, "attribute"
            )
            for name, value in sorted(attributes.items())
            if not name.startswith(XSI)
        )
        count += len(fields)

        if count > limits.max_nodes:
            raise NormalizeDocumentsError("The input exceeds max_nodes.")

        text = node.text or ""
        mixed = bool(children) and (
            bool(text.strip())
            or any(
                (getattr(child, "tail", None) or "").strip() for child in node.children
            )
        )

        if nil in ("true", "1"):
            kind, value, children = "null", None, ()
        elif mixed:
            value = _text_content(node)
            kind, children = _xml_type(value), ()
        elif children:
            kind, value = "parent", None
        else:
            kind = _xml_type(text)
            value = text if kind != "null" else None

        return NormalizedNode(node.tag, kind, value, (*children, *fields), position)

    return tuple(visit(root, ()) for root in roots)


def _text_content(node: ProbabilitySpaceNode) -> str:
    return (node.text or "") + "".join(
        _text_content(child) + (getattr(child, "tail", None) or "")
        for child in node.children
    )
