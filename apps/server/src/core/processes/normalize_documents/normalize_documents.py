import math
import re
from collections.abc import Sequence
from datetime import date, datetime

from core.entities import DocumentNode
from core.entities.inference import FieldObservation, InferenceLimits
from core.processes.normalize_documents import NormalizeDocumentsError

XSI = "{http://www.w3.org/2001/XMLSchema-instance}"


def _xml_type(value: str) -> str:
    """Infer a supported scalar type from XML text, treating whitespace as null."""
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
    roots: Sequence[DocumentNode], limits: InferenceLimits | None = None
) -> tuple[FieldObservation, ...]:
    """Unify empty values and attribute fields, and flatten text decorations."""
    limits = limits or InferenceLimits()

    # Reject an over-budget collection as a whole; truncating it would silently
    # change the sample from which field and structure frequencies are calculated.
    if len(roots) > limits.max_documents:
        raise NormalizeDocumentsError("The document count exceeds max_documents.")

    count = 0
    active: set[int] = set()

    def visit(node: DocumentNode, position: tuple[int, ...]) -> FieldObservation:
        """Normalize one source node while preserving its document-tree position."""
        nonlocal count
        count += 1

        # Resource limits bound accepted observations and nesting; partial traversal
        # would misrepresent the source document as a smaller observed structure.
        if count > limits.max_nodes or len(position) >= limits.max_depth:
            raise NormalizeDocumentsError("The input exceeds node or depth limits.")

        # A document occurrence must have finite tree ancestry. Revisiting an active
        # ancestor would make its structural path and descendant count unbounded.
        if id(node) in active:
            raise NormalizeDocumentsError("The document contains a cycle.")

        # Fields are grouped by their source names within a parent context, so an
        # unnamed or non-string label cannot identify a field in this model.
        if not isinstance(node.tag, str) or not node.tag:
            raise NormalizeDocumentsError("Field names must be nonempty strings.")

        active.add(id(node))
        children = tuple(
            visit(child, (*position, index))
            for index, child in enumerate(node.children)
        )
        active.remove(id(node))
        source_format = getattr(node, "format", "xml")

        if source_format in ("json", "yaml"):
            kind = node.value_type or "parent"
            value = node.value

            if kind == "string" and not str(value or "").strip():
                kind, value = "null", None

            return FieldObservation(
                node.tag, kind, value, children, position, node.role
            )

        attributes = getattr(node, "attributes", {})
        nil = attributes.get(XSI + "nil", "false").strip()

        # xsi:nil determines whether an XML value is explicitly null. Reject an
        # invalid flag instead of guessing between null and ordinary content.
        if nil not in ("true", "false", "1", "0"):
            raise NormalizeDocumentsError("Invalid xsi:nil value.")

        fields = tuple(
            FieldObservation(
                name, _xml_type(value), value or None, (), position, "attribute"
            )
            for name, value in sorted(attributes.items())
            if not name.startswith(XSI)
        )
        count += len(fields)

        # XML attributes become independent field observations and must consume the
        # same observation budget as elements.
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

        return FieldObservation(node.tag, kind, value, (*children, *fields), position)

    return tuple(visit(root, ()) for root in roots)


def _text_content(node: DocumentNode) -> str:
    """Collect mixed XML text in source order, including text after child elements."""
    return (node.text or "") + "".join(
        _text_content(child) + (getattr(child, "tail", None) or "")
        for child in node.children
    )
