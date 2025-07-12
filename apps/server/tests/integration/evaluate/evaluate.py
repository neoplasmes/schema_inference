import argparse
import json
from pathlib import Path

from documents_generator import GenerationOptions, generate_collections

from app.use_cases.infer_schema import InferSchema
from env.tools.lexical import CorpusLexicalResourceTool
from integration.support import evaluate_manifest, write_evaluation_artifacts
from main import build_document_reader


def main() -> None:
    """Write inference JSON and evaluation reports without starting an API server."""
    parser = argparse.ArgumentParser(
        description="Inspect document inference and observed variant frequencies"
    )
    parser.add_argument("--output", type=Path, required=True)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--manifest", type=Path)
    source.add_argument("--all", action="store_true")
    parser.add_argument("--fail-on-forbidden", action="store_true")
    arguments = parser.parse_args()
    paths = []

    if arguments.manifest:
        paths.append(arguments.manifest)
    else:
        fixtures = Path(__file__).parents[2] / "fixtures"
        paths.extend(sorted((fixtures / "claude_tests").glob("*/expected.json")))

        if not paths:
            parser.error(f"No handwritten fixture manifests found in {fixtures}")

        directory = arguments.output / "inputs" / "generated"
        generate_collections(directory, GenerationOptions(scenario="all"))
        paths.extend(sorted(directory.glob("*/manifest.json")))

    inference = InferSchema(lexical_resource=CorpusLexicalResourceTool())
    reader = build_document_reader()
    summary = []

    for path in paths:
        manifest = json.loads(path.read_text(encoding="utf-8"))
        roots = []

        for document in manifest["documents"]:
            with (path.parent / document["path"]).open("rb") as source:
                roots.append(reader.read(source, document["path"]))

        result = inference.analyze(roots)
        report = evaluate_manifest(manifest, path.parent, result)
        report["input_manifest"] = str(path.resolve())
        name = manifest["scenario"]

        if "seed" in manifest:
            name += f"-seed-{manifest['seed']}"

        if "distribution" in manifest:
            name += f"-{manifest['distribution']['kind']}-{manifest['format']}"

        write_evaluation_artifacts(arguments.output, name, result, report)
        row = {
            "scenario": name,
            "documents": report["documents"],
            "fields": report["fields"],
            "forbidden_merges": len(report["forbidden_field_merges"]),
            "missing_annotations": len(report["missing_annotations"]),
            "normalized_annotations": len(report["normalized_annotations"]),
            "invalid_distributions": len(report["invalid_distributions"]),
            "warnings": result["warnings"],
        }
        summary.append(row)
        print(json.dumps(row, ensure_ascii=False, allow_nan=False), flush=True)

    (arguments.output / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )

    if arguments.fail_on_forbidden and any(
        row["forbidden_merges"]
        or row["invalid_distributions"]
        or row["missing_annotations"]
        for row in summary
    ):
        raise SystemExit(1)
