from typing import Any, Dict

from core.entities.schema_node import SchemaNode
from app.ports.tools.schema_writer_tool import SchemaWriter
from core.processes.build_xsd_proc import build_xsd


class GenerateSchema:
    def __init__(self, writer: SchemaWriter):
        self._writer = writer

    def execute(self, schema: Dict[str, Any]) -> str:
        return self._writer.generate(build_xsd(SchemaNode.from_dict(schema)))
