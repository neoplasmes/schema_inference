import argparse
import json
import xml.etree.ElementTree as ET
from pathlib import Path

from api.composition import SERVER_ROOT, build_infer_schema


def main() -> None:
    """Infer a grammar space from XML files and write its JSON representation."""
    parser = argparse.ArgumentParser()
    parser.add_argument("files", nargs="+", type=Path)
    parser.add_argument("--output", type=Path, default=SERVER_ROOT / "sample.json")
    arguments = parser.parse_args()

    trees = [ET.parse(path) for path in arguments.files]
    schema = build_infer_schema().execute(trees)
    arguments.output.write_text(
        json.dumps(json.loads(schema), indent=2, ensure_ascii=False), encoding="utf-8"
    )


if __name__ == "__main__":
    main()
