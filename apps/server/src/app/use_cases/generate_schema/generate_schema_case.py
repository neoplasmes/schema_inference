from typing import Any, Dict

from app.ports.tools import SchemaWriter
from core.entities import SchemaNode
from core.processes.build_xsd import build_xsd


class GenerateSchema:
    def __init__(self, writer: SchemaWriter):
        self._writer = writer

    def execute(self, schema: Dict[str, Any]) -> str:
        return self._writer.generate(build_xsd(SchemaNode.from_dict(schema)))
