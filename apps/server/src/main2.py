import argparse
import json
from pathlib import Path

from api.composition import SERVER_ROOT, build_generate_schema


def main() -> None:
    """Generate an XSD document from the schema selected in the client."""
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "source", nargs="?", type=Path, default=SERVER_ROOT / "request.json"
    )
    parser.add_argument("--output", type=Path, default=SERVER_ROOT / "schema.xsd")
    arguments = parser.parse_args()

    schema = json.loads(arguments.source.read_text(encoding="utf-8"))
    result = build_generate_schema().execute(schema)
    arguments.output.write_text(result, encoding="utf-8")


if __name__ == "__main__":
    main()
