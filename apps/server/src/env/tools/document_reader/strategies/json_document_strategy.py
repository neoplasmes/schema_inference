import json
import math
from typing import Any, BinaryIO

from app.ports.tools.document_reader import InvalidDocumentError
from core.entities import JsonDocumentNode


class JsonDocumentStrategy:
    """Read JSON into the shared mapping/sequence model without losing empty containers."""

    def read(self, source: BinaryIO) -> JsonDocumentNode:
        try:
            value = json.load(
                source, object_pairs_hook=self._object, parse_constant=self._constant
            )

            return self._convert(value, "$document", "document", 0, [0])
        except (ValueError, UnicodeError, RecursionError) as error:
            raise InvalidDocumentError(str(error)) from error

    @staticmethod
    def _object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result = {}

        for name, value in pairs:
            if name in result or not name:
                raise ValueError("JSON object names must be nonempty and unique.")

            result[name] = value

        return result

    @staticmethod
    def _constant(value: str) -> None:
        raise ValueError(f"Invalid JSON number: {value}.")

    def _convert(
        self, value: Any, tag: str, role: str, depth: int, count: list[int]
    ) -> JsonDocumentNode:
        count[0] += 1

        if depth > 256 or count[0] > 100_000:
            raise ValueError("The JSON document is too large or too deeply nested.")

        if isinstance(value, dict):
            return JsonDocumentNode(
                tag,
                children=[
                    self._convert(item, name, "field", depth + 1, count)
                    for name, item in value.items()
                ],
                node_kind="mapping",
                role=role,
                ordered=False,
            )

        if isinstance(value, list):
            return JsonDocumentNode(
                tag,
                children=[
                    self._convert(item, "[]", "item", depth + 1, count)
                    for item in value
                ],
                node_kind="sequence",
                role=role,
            )

        if isinstance(value, float) and not math.isfinite(value):
            raise ValueError("JSON numbers must be finite.")

        value_type = {
            str: "string",
            int: "integer",
            float: "number",
            bool: "boolean",
            type(None): "null",
        }[type(value)]

        return JsonDocumentNode(
            tag, node_kind="scalar", role=role, value_type=value_type, value=value
        )
