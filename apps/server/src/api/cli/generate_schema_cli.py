import argparse
import json
from pathlib import Path

from app.use_cases.generate_schema_case import GenerateSchema


def run(generate_schema: GenerateSchema, output_root: Path) -> None:
    """Generate an XSD document from the schema selected in the client."""
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "source", nargs="?", type=Path, default=output_root / "request.json"
    )
    parser.add_argument("--output", type=Path, default=output_root / "schema.xsd")
    arguments = parser.parse_args()

    schema = json.loads(arguments.source.read_text(encoding="utf-8"))
    result = generate_schema.execute(schema)
    arguments.output.write_text(result, encoding="utf-8")
