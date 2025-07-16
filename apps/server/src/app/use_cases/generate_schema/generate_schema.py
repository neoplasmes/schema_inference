from typing import Any

from app.ports.tools.schema_writer import SchemaWriter
from app.use_cases.generate_schema import GenerateSchemaError, parse_selected_schema
from core.entities import SelectedSchemaNodeError
from core.processes.build_xsd import build_xsd


class GenerateSchema:
    """Validate a selected schema and serialize its XSD representation."""

    def __init__(self, writer: SchemaWriter):
        self._writer = writer

    def execute(self, schema: dict[str, Any]) -> str:
        """Reject invalid selections before invoking the schema writer."""
        try:
            selected = parse_selected_schema(schema)
        except SelectedSchemaNodeError as error:
            raise GenerateSchemaError(str(error)) from error

        return self._writer.generate(build_xsd(selected))
