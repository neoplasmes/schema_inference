import argparse
import json
from pathlib import Path

from xml_data_generator import GenerationOptions, generate_dataset

from app.use_cases.infer_schema import InferSchema
from env.tools.assignment import ScipyAssignmentTool
from env.tools.lexical import CorpusLexicalResourceTool
from env.tools.xml import ElementTreeXmlDocumentTool
from integration.support import evaluate_manifest, write_evaluation_artifacts


def main() -> None:
    """Write inference JSON and evaluation reports without starting an API server."""
    parser = argparse.ArgumentParser(
        description="Inspect XML inference against an oracle"
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
        paths.extend(sorted((fixtures / "manual").glob("*/expected.json")))
        paths.extend(sorted((fixtures / "holdout").glob("*/expected.json")))

        if not paths:
            parser.error(f"No handwritten fixture manifests found in {fixtures}")

        for seed in (42, 903):
            directory = arguments.output / "inputs" / f"generated-{seed}"
            generate_dataset(directory, GenerationOptions(seed=seed, documents=3))
            paths.append(directory / "manifest.json")

    inference = InferSchema(
        lexical_resource=CorpusLexicalResourceTool(), assignment=ScipyAssignmentTool()
    )
    reader = ElementTreeXmlDocumentTool()
    summary = []

    for path in paths:
        manifest = json.loads(path.read_text(encoding="utf-8"))
        roots = []

        for document in manifest["documents"]:
            with (path.parent / document["path"]).open("rb") as source:
                roots.append(reader.read(source))

        result = json.loads(inference.execute(roots))
        report = evaluate_manifest(manifest, path.parent, result)
        name = manifest["scenario"]

        if "seed" in manifest:
            name += f"-seed-{manifest['seed']}"

        write_evaluation_artifacts(arguments.output, name, result, report)
        row = {
            "scenario": name,
            "documents": len(manifest["documents"]),
            "expected_pairs": report["element_profile_pairs_expected"],
            "candidate_recall": report["candidate_recall"],
            "equivalent": report["equivalent"],
            "same_namespace_equivalent": report["same_namespace_equivalent"],
            "cross_namespace_pairs_expected": report["cross_namespace_pairs_expected"],
            "attribute_or_transform_pairs_not_scored": report[
                "attribute_or_transform_pairs_not_scored"
            ],
            "forbidden_equivalences": len(report["forbidden_equivalent_pairs"]),
            "forbidden_groups": len(report["forbidden_group_pairs"]),
            "missing_profiles": len(report["missing_profile_annotations"]),
            "warnings": result["warnings"],
        }
        summary.append(row)
        print(json.dumps(row, ensure_ascii=False, allow_nan=False), flush=True)

    (arguments.output / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )

    if arguments.fail_on_forbidden and any(
        row["forbidden_equivalences"] or row["forbidden_groups"] for row in summary
    ):
        raise SystemExit(1)
