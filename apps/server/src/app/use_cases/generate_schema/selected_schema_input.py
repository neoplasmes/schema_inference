from typing import Any

from app.use_cases.generate_schema import GenerateSchemaError
from core.entities import SelectedSchemaNode


def parse_selected_schema(data: Any, depth: int = 0) -> SelectedSchemaNode:
    """Convert the editor selection to domain data without accepting malformed trees."""
    if depth >= 128:
        raise GenerateSchemaError("The selected schema exceeds the maximum depth.")

    if not isinstance(data, dict):
        raise GenerateSchemaError("Every schema node must be an object.")

    if "name" not in data or "chosenType" not in data:
        raise GenerateSchemaError("Every schema node requires name and chosenType.")

    if data.get("type", "LEAF") != "LEAF":
        raise GenerateSchemaError(
            "The selected schema must contain element nodes only."
        )

    children = data.get("children", [])

    if not isinstance(children, list):
        raise GenerateSchemaError("Schema children must be an array.")

    chosen_type = data["chosenType"]

    return SelectedSchemaNode(
        name=data["name"],
        chosen_type="null" if chosen_type == "empty" else chosen_type,
        min_occurs=data.get("minOccurs", 1),
        max_occurs=data.get("maxOccurs", 1),
        children=tuple(parse_selected_schema(child, depth + 1) for child in children),
        attributes=data.get("attributes", {}),
    )
