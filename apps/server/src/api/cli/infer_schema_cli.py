import argparse
import json
from pathlib import Path

from app.ports.tools.xml_document_tool import XmlDocumentTool
from app.use_cases.infer_schema_case import InferSchema


def run(infer_schema: InferSchema, xml_reader: XmlDocumentTool, output_root: Path) -> None:
    """Infer a grammar space from XML files and write its JSON representation."""
    parser = argparse.ArgumentParser()
    parser.add_argument("files", nargs="+", type=Path)
    parser.add_argument("--output", type=Path, default=output_root / "sample.json")
    arguments = parser.parse_args()

    roots = []
    for path in arguments.files:
        with path.open("rb") as source:
            roots.append(xml_reader.read(source))
    schema = infer_schema.execute(roots)
    arguments.output.write_text(
        json.dumps(json.loads(schema), indent=2, ensure_ascii=False), encoding="utf-8"
    )
