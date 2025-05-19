from typing import Any, Dict

from domain.entities.schema_node import SchemaNode
from domain.ports import SchemaWriter


class GenerateSchema:
    def __init__(self, writer: SchemaWriter):
        self._writer = writer

    def execute(self, schema: Dict[str, Any]) -> str:
        return self._writer.generate(SchemaNode.from_dict(schema))
